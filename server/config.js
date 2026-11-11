/**
 * =============================================================================
 * FACE ACCESS - CONFIGURAÇÕES GERAIS DO SISTEMA
 * =============================================================================
 * 
 * DIAGNÓSTICO MATEMÁTICO SOBRE A ESCALA DE DISTÂNCIA:
 * Na normalização geométrica por centróide e tamanho unitário (RMS = 1), as
 * distâncias "média por ponto" entre faces humanas ficam na escala de CENTÉSIMOS
 * (tipicamente entre 0.015 e 0.045 para a mesma pessoa, e acima de 0.060 para impostores).
 * O limiar inicial de 0.35 era excessivamente alto (uma ordem de grandeza acima),
 * o que causava falso aceite garantido de qualquer rosto humano.
 * 
 * Por padrão, adotamos um limiar conservador inicial de 0.050 para o modo landmarks,
 * sujeito à calibração automática pela tela /calibracao.html.
 */

const fs = require('fs');
const path = require('path');

const CAMINHO_CONFIG = path.join(__dirname, '..', 'data', 'config.json');

// Modo de Embedding: "landmarks" (padrão didático) ou "modelo" (MobileFaceNet ONNX)
const MODO_EMBEDDING_INICIAL = process.env.EMBEDDING_MODE || 'landmarks';

const CONFIG_PADRAO = {
  porta: process.env.PORT || 3000,
  
  // Modo ativo de extração
  modoEmbedding: MODO_EMBEDDING_INICIAL,

  // Versão do modelo correspondente
  versaoModelo: MODO_EMBEDDING_INICIAL === 'modelo' ? 'mobilefacenet-v1' : 'mediapipe-pontos-estaveis-v2',
  
  // Limiar conservador padrão:
  // - Para landmarks: 0.050 (RMSD por ponto). Distâncias > 0.050 são rejeitadas.
  // - Para modelo: 0.350 (distância de cosseno = 1 - similaridade, onde sim >= 0.65).
  limiar: MODO_EMBEDDING_INICIAL === 'modelo' ? 0.35 : 0.05,

  // Razão mínima de margem contra o segundo melhor candidato (1.3x)
  razaoMargemMinima: 1.3,

  // Quantidade de frames consecutivos que devem passar para conceder ACESSO LIBERADO
  framesConsecutivosExigidos: 10,

  // Tolerância para validação de pose no frontend
  tamanhoMinimoFace: 0.14
};

function carregarConfig() {
  try {
    if (fs.existsSync(CAMINHO_CONFIG)) {
      const conteudo = fs.readFileSync(CAMINHO_CONFIG, 'utf-8');
      const dados = JSON.parse(conteudo);
      const modo = dados.modoEmbedding || CONFIG_PADRAO.modoEmbedding;
      const versao = modo === 'modelo' ? 'mobilefacenet-v1' : 'mediapipe-pontos-estaveis-v2';
      return {
        ...CONFIG_PADRAO,
        ...dados,
        modoEmbedding: modo,
        versaoModelo: versao,
        limiar: typeof dados.limiar === 'number' ? dados.limiar : (modo === 'modelo' ? 0.35 : 0.05)
      };
    }
  } catch (erro) {
    console.warn('[CONFIG] Aviso ao ler config.json, usando padrão:', erro.message);
  }
  return { ...CONFIG_PADRAO };
}

let configAtual = carregarConfig();

function obterConfig() {
  return { ...configAtual };
}

function atualizarConfig({ limiar, modoEmbedding }) {
  if (modoEmbedding && (modoEmbedding === 'landmarks' || modoEmbedding === 'modelo')) {
    configAtual.modoEmbedding = modoEmbedding;
    configAtual.versaoModelo = modoEmbedding === 'modelo' ? 'mobilefacenet-v1' : 'mediapipe-pontos-estaveis-v2';
  }

  if (typeof limiar === 'number' && !isNaN(limiar) && limiar > 0) {
    configAtual.limiar = parseFloat(limiar.toFixed(4));
  }

  try {
    const dirData = path.dirname(CAMINHO_CONFIG);
    if (!fs.existsSync(dirData)) {
      fs.mkdirSync(dirData, { recursive: true });
    }
    fs.writeFileSync(CAMINHO_CONFIG, JSON.stringify({
      limiar: configAtual.limiar,
      modoEmbedding: configAtual.modoEmbedding
    }, null, 2), 'utf-8');
  } catch (erro) {
    console.error('[CONFIG] Erro ao persistir config.json:', erro.message);
  }

  return configAtual;
}

function atualizarLimiar(novoLimiar) {
  return atualizarConfig({ limiar: novoLimiar });
}

module.exports = {
  obterConfig,
  atualizarConfig,
  atualizarLimiar,
  CONFIG_PADRAO
};
