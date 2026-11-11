/**
 * =============================================================================
 * FACE ACCESS - server/index.js
 * Servidor HTTP Express e Endpoints da API de Reconhecimento Facial
 * =============================================================================
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');

const { obterConfig, atualizarConfig, atualizarLimiar } = require('./config');
const {
  normalizar,
  distanciaMediaPorPonto,
  similaridadeCosseno,
  distanciaCosseno,
  media,
  salvarReferencia,
  carregarReferencia,
  NUM_PONTOS_ESTAVEIS,
  INDICES_PONTOS_ESTAVEIS
} = require('./embedding');
const {
  obterPessoasParaComparacao,
  listarPessoasPublico,
  adicionarPessoa,
  excluirPessoa,
  inicializarStorage
} = require('./storage');

const app = express();
const config = obterConfig();

// Inicializa arquivos e diretórios de dados
inicializarStorage();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Servir arquivos estáticos do Frontend (HTML, CSS, JS puro)
app.use(express.static(path.join(__dirname, '..', 'public')));

// =============================================================================
// VALIDAÇÕES AUXILIARES
// =============================================================================

function validarLandmarks(landmarks) {
  if (!Array.isArray(landmarks)) {
    return { valido: false, mensagem: 'Landmarks devem ser fornecidos em um array.' };
  }
  if (landmarks.length < 468) {
    return {
      valido: false,
      mensagem: `Quantidade insuficiente de pontos: recebido ${landmarks.length}, esperado no mínimo 468.`
    };
  }

  // Valida os pontos estáveis utilizados
  for (let i = 0; i < INDICES_PONTOS_ESTAVEIS.length; i++) {
    const idx = INDICES_PONTOS_ESTAVEIS[i];
    const p = landmarks[idx];
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number' ||
        !isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) {
      return {
        valido: false,
        mensagem: `Ponto anatômico no índice ${idx} contém coordenadas inválidas ou não finitas.`
      };
    }
  }

  return { valido: true };
}

// =============================================================================
// ROTAS DA API
// =============================================================================

/**
 * POST /cadastrar
 * Body esperado: {
 *   nome: string,
 *   consentimento: boolean,
 *   capturas?: Array(5)[Array(478)[{x, y, z}]],
 *   capturasEmbeddings?: Array(5)[Array(512)[number]], // opcional para modo modelo
 *   modoEmbedding?: "landmarks" | "modelo"
 * }
 */
app.post('/cadastrar', async (req, res) => {
  try {
    const { nome, consentimento, capturas, capturasEmbeddings, modoEmbedding } = req.body;

    if (!nome || typeof nome !== 'string' || !nome.trim()) {
      return res.status(400).json({ erro: 'O campo "nome" é obrigatório e não pode ser vazio.' });
    }

    if (consentimento !== true) {
      return res.status(400).json({
        erro: 'Consentimento biométrico obrigatório nos termos da LGPD. Marque o checkbox para prosseguir.'
      });
    }

    const cfg = obterConfig();
    const modo = modoEmbedding || cfg.modoEmbedding;

    let embeddings = [];
    let vetorMedio = [];

    if (modo === 'modelo' && Array.isArray(capturasEmbeddings) && capturasEmbeddings.length === 5) {
      // Modo modelo ONNX (MobileFaceNet - 512 floats)
      embeddings = capturasEmbeddings;
      vetorMedio = media(embeddings);

      // Normaliza L2 o vetor médio
      let norm = 0;
      for (let i = 0; i < vetorMedio.length; i++) norm += vetorMedio[i] * vetorMedio[i];
      norm = Math.sqrt(norm);
      if (norm > 1e-9) {
        for (let i = 0; i < vetorMedio.length; i++) vetorMedio[i] /= norm;
      }
    } else {
      // Modo landmarks anatômicos estáveis (94 pontos -> 282 dimensões)
      if (!Array.isArray(capturas) || capturas.length !== 5) {
        return res.status(400).json({
          erro: 'São necessárias exatamente 5 capturas guiadas para concluir o cadastro.'
        });
      }

      for (let c = 0; c < capturas.length; c++) {
        const checagem = validarLandmarks(capturas[c]);
        if (!checagem.valido) {
          return res.status(400).json({
            erro: `Falha na validação da captura ${c + 1}: ${checagem.mensagem}`
          });
        }
      }

      // Referência canônica para Procrustes
      let refExistente = carregarReferencia();
      if (!refExistente) {
        console.log('[CADASTRO] Primeiro cadastro detectado! Gerando referência Procrustes dos 94 pontos estáveis...');
        const resPrimeira = normalizar(capturas[0], null);
        salvarReferencia(resPrimeira.pontosNormalizados);
        refExistente = resPrimeira.pontosNormalizados;
      }

      for (let c = 0; c < 5; c++) {
        const normalizado = normalizar(capturas[c], refExistente);
        embeddings.push(normalizado.vetor);
      }

      vetorMedio = media(embeddings);
    }

    const pessoaCriada = await adicionarPessoa({
      nome: nome.trim(),
      consentimento: true,
      embeddings,
      media: vetorMedio
    });

    return res.status(201).json({
      sucesso: true,
      mensagem: `Pessoa "${pessoaCriada.nome}" cadastrada com sucesso!`,
      pessoa: pessoaCriada
    });
  } catch (erro) {
    console.error('[ERRO /cadastrar]:', erro);
    return res.status(500).json({ erro: erro.message || 'Erro interno no servidor ao processar cadastro.' });
  }
});

/**
 * POST /verificar
 * Body esperado: {
 *   landmarks?: Array(478)[{x, y, z}],
 *   embedding?: Array(512)[number]
 * }
 */
app.post('/verificar', async (req, res) => {
  try {
    const { landmarks, embedding } = req.body;
    const cfg = obterConfig();
    const pessoas = await obterPessoasParaComparacao();

    if (pessoas.length === 0) {
      return res.json({
        pessoaId: null,
        nome: 'Pessoa Não Cadastrada',
        candidatoMaisProximo: null,
        distancia: null,
        distanciaSegundo: null,
        nomeSegundo: null,
        razaoMargem: null,
        margemAtendida: false,
        passou: false,
        limiar: cfg.limiar,
        mensagem: 'Nenhuma pessoa cadastrada no sistema. Cadastre ao menos um rosto primeiro.',
        candidatos: []
      });
    }

    let vetorAtual = null;

    if (cfg.modoEmbedding === 'modelo') {
      if (!Array.isArray(embedding) || embedding.length !== 512) {
        return res.status(400).json({ erro: 'Vetor de embedding ONNX de 512 dimensões esperado.' });
      }
      vetorAtual = embedding;
    } else {
      const checagem = validarLandmarks(landmarks);
      if (!checagem.valido) {
        return res.status(400).json({ erro: checagem.mensagem });
      }
      const normalizadoAtual = normalizar(landmarks);
      vetorAtual = normalizadoAtual.vetor;
    }

    const listaCandidatos = [];

    // REGRA 3: Comparar ESTRITAMENTE contra a MÉDIA do cadastro (e não contra o mínimo das 5 capturas)
    for (const pessoa of pessoas) {
      if (!Array.isArray(pessoa.media) || pessoa.media.length !== vetorAtual.length) {
        continue;
      }

      let distPessoa = Infinity;
      if (cfg.modoEmbedding === 'modelo') {
        distPessoa = distanciaCosseno(vetorAtual, pessoa.media);
      } else {
        distPessoa = distanciaMediaPorPonto(vetorAtual, pessoa.media);
      }

      const distArredondada = parseFloat(distPessoa.toFixed(4));
      listaCandidatos.push({
        pessoaId: pessoa.id,
        nome: pessoa.nome,
        distancia: distArredondada
      });
    }

    if (listaCandidatos.length === 0) {
      return res.json({
        pessoaId: null,
        nome: 'Pessoa Não Cadastrada',
        distancia: null,
        passou: false,
        limiar: cfg.limiar,
        mensagem: 'Nenhum cadastro compatível com a versão de modelo atual.',
        candidatos: []
      });
    }

    // Ordena do menor para o maior (mais parecido primeiro)
    listaCandidatos.sort((a, b) => a.distancia - b.distancia);

    const melhor = listaCandidatos[0];
    const segundo = listaCandidatos.length > 1 ? listaCandidatos[1] : null;

    // REGRA 3: Exigir margem mínima contra o segundo candidato (1.3x)
    let margemAtendida = true;
    let razaoMargem = null;

    if (segundo) {
      razaoMargem = segundo.distancia / (melhor.distancia + 1e-6);
      razaoMargem = parseFloat(razaoMargem.toFixed(2));
      margemAtendida = razaoMargem >= cfg.razaoMargemMinima;
    }

    const distAbaixoLimiar = melhor.distancia < cfg.limiar;
    const passou = distAbaixoLimiar && margemAtendida;

    // REGRA 1: Diagnóstico com logs detalhados
    const strSegundo = segundo
      ? ` | 2º: "${segundo.nome}" (d = ${segundo.distancia.toFixed(4)}) | Margem: ${razaoMargem}x (mín: ${cfg.razaoMargemMinima}x)`
      : ' | (Apenas 1 pessoa na base)';

    let motivoReprovacao = '';
    if (!passou) {
      if (!distAbaixoLimiar) motivoReprovacao = `[RECUSADO: d=${melhor.distancia} >= limiar=${cfg.limiar}]`;
      else if (!margemAtendida) motivoReprovacao = `[RECUSADO: margem ${razaoMargem}x < ${cfg.razaoMargemMinima}x]`;
    }

    console.log(
      `[VERIFICAR] Modo: ${cfg.modoEmbedding} | Melhor: "${melhor.nome}" (d = ${melhor.distancia.toFixed(4)})${strSegundo} | Limiar: ${cfg.limiar} | Veredito: ${passou ? 'APROVADO' : motivoReprovacao}`
    );

    return res.json({
      pessoaId: passou ? melhor.pessoaId : null,
      nome: passou ? melhor.nome : 'Pessoa Não Cadastrada',
      candidatoMaisProximo: melhor.nome,
      distancia: melhor.distancia,
      distanciaSegundo: segundo ? segundo.distancia : null,
      nomeSegundo: segundo ? segundo.nome : null,
      razaoMargem,
      margemAtendida,
      limiar: cfg.limiar,
      passou,
      candidatos: listaCandidatos
    });
  } catch (erro) {
    console.error('[ERRO /verificar]:', erro);
    return res.status(500).json({ erro: erro.message || 'Erro interno ao verificar biometria.' });
  }
});

/**
 * GET /pessoas
 */
app.get('/pessoas', async (req, res) => {
  try {
    const lista = await listarPessoasPublico();
    return res.json(lista);
  } catch (erro) {
    console.error('[ERRO /pessoas]:', erro);
    return res.status(500).json({ erro: 'Erro ao listar cadastros.' });
  }
});

/**
 * DELETE /pessoas/:id
 */
app.delete('/pessoas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sucesso = await excluirPessoa(id);
    if (!sucesso) {
      return res.status(404).json({ erro: 'Pessoa não encontrada para exclusão.' });
    }
    return res.json({ sucesso: true, mensagem: 'Pessoa excluída com sucesso.' });
  } catch (erro) {
    console.error('[ERRO /pessoas/:id]:', erro);
    return res.status(500).json({ erro: 'Erro ao excluir cadastro.' });
  }
});

/**
 * GET /config
 */
app.get('/config', (req, res) => {
  try {
    const cfg = obterConfig();
    return res.json({
      limiar: cfg.limiar,
      modoEmbedding: cfg.modoEmbedding,
      versaoModelo: cfg.versaoModelo,
      razaoMargemMinima: cfg.razaoMargemMinima,
      framesConsecutivosExigidos: cfg.framesConsecutivosExigidos,
      numPontosEstaveis: NUM_PONTOS_ESTAVEIS
    });
  } catch (erro) {
    console.error('[ERRO GET /config]:', erro);
    return res.status(500).json({ erro: 'Erro ao obter configurações.' });
  }
});

/**
 * PUT /config
 */
app.put('/config', (req, res) => {
  try {
    const { limiar, modoEmbedding } = req.body;
    const cfgAtualizada = atualizarConfig({ limiar, modoEmbedding });
    console.log(`[CONFIG] Atualizado: Limiar = ${cfgAtualizada.limiar} | Modo = ${cfgAtualizada.modoEmbedding}`);

    return res.json({
      sucesso: true,
      mensagem: 'Configurações salvas com sucesso.',
      config: cfgAtualizada
    });
  } catch (erro) {
    console.error('[ERRO PUT /config]:', erro);
    return res.status(500).json({ erro: erro.message || 'Erro ao atualizar configuração.' });
  }
});

// Inicialização do servidor
const PORTA = config.porta;
let servidor = null;

if (require.main === module) {
  servidor = app.listen(PORTA, () => {
    console.log('================================================================');
    console.log(`  FACE ACCESS - SERVIDOR INICIADO NA PORTA ${PORTA}`);
    console.log(`  URL Local: http://localhost:${PORTA}`);
    console.log(`  Modo Embedding: ${config.modoEmbedding}`);
    console.log(`  Versão do Modelo: ${config.versaoModelo}`);
    console.log(`  Limiar Padrão: ${config.limiar}`);
    console.log(`  Razão de Margem Mínima: ${config.razaoMargemMinima}x`);
    console.log('================================================================');
  });
}

module.exports = { app, servidor };
