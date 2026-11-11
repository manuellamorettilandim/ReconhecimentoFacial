/**
 * =============================================================================
 * FACE ACCESS - server/storage.js
 * Módulo de Armazenamento e Persistência de Cadastros (Supabase + Fallback Local)
 * =============================================================================
 * 
 * DIRETRIZES DE PRIVACIDADE E MINIMIZAÇÃO DE DADOS (LGPD):
 * - NUNCA armazena fotos, vídeos ou imagens de câmeras.
 * - NUNCA armazena coordenadas brutas da tela ou landmarks crus.
 * - Armazena ESTRITAMENTE vetores normalizados (embeddings).
 * - A API pública (GET /pessoas) NUNCA expõe esses vetores numéricos para o cliente.
 * 
 * SCHEMA SUPABASE INTEGRADO:
 * - nome: string
 * - embedding: array de floats (vetor biométrico médio)
 * - timerstamp: timestamptz (data/hora de cadastro)
 * - softdelet: boolean (exclusão lógica)
 * - delete_at: timestamptz (data/hora do soft delete)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { obterConfig } = require('./config');
const { obterSupabase } = require('./supabase');

const CAMINHO_PESSOAS = path.join(__dirname, '..', 'data', 'pessoas.json');

/**
 * Garante que o arquivo data/pessoas.json exista para redundância/cache local.
 */
function inicializarStorage() {
  const dir = path.dirname(CAMINHO_PESSOAS);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(CAMINHO_PESSOAS)) {
    fs.writeFileSync(CAMINHO_PESSOAS, JSON.stringify([], null, 2), 'utf-8');
  }
}

/**
 * Lê o arquivo data/pessoas.json de disco de forma segura.
 * @returns {Array<object>}
 */
function lerArquivoPessoas() {
  inicializarStorage();
  try {
    const conteudo = fs.readFileSync(CAMINHO_PESSOAS, 'utf-8');
    if (!conteudo.trim()) return [];
    return JSON.parse(conteudo);
  } catch (erro) {
    console.error('[STORAGE] Erro ao ler data/pessoas.json local:', erro.message);
    return [];
  }
}

/**
 * Grava a lista atualizada em data/pessoas.json com formatação legível.
 * @param {Array<object>} pessoas 
 */
function salvarArquivoPessoas(pessoas) {
  inicializarStorage();
  try {
    fs.writeFileSync(CAMINHO_PESSOAS, JSON.stringify(pessoas, null, 2), 'utf-8');
  } catch (erro) {
    console.error('[STORAGE] Erro ao gravar data/pessoas.json local:', erro.message);
  }
}

/**
 * Retorna as pessoas ativas para uso interno no matching facial do backend.
 * Consulta prioritariamente o Supabase (ignorando softdelet = true).
 * 
 * @returns {Promise<Array<object>>}
 */
async function obterPessoasParaComparacao() {
  const supabase = obterSupabase();
  const config = obterConfig();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('pessoas')
        .select('*');

      if (error) {
        console.error('[STORAGE-SUPABASE] Erro ao obter cadastros no Supabase:', error.message);
      } else if (Array.isArray(data)) {
        const validas = [];
        for (const p of data) {
          // Ignora se foi deletado por soft delete
          if (p.softdelet === true || p.delete_at) {
            continue;
          }

          let vetor = null;
          if (Array.isArray(p.embedding)) {
            vetor = p.embedding;
          } else if (p.embedding && Array.isArray(p.embedding.media)) {
            vetor = p.embedding.media;
          } else if (Array.isArray(p.media)) {
            vetor = p.media;
          } else if (Array.isArray(p.embeddings) && Array.isArray(p.embeddings[0])) {
            vetor = p.embeddings[0];
          }

          if (Array.isArray(vetor) && vetor.length > 0) {
            validas.push({
              id: p.id,
              nome: p.nome,
              versaoModelo: p.versao_modelo || config.versaoModelo,
              embeddings: [vetor],
              media: vetor
            });
          }
        }
        return validas;
      }
    } catch (erro) {
      console.error('[STORAGE-SUPABASE] Exceção ao consultar comparáveis:', erro.message);
    }
  }

  // Fallback local caso Supabase não esteja configurado ou falhe
  const todas = lerArquivoPessoas();
  const validas = [];

  for (const pessoa of todas) {
    if (pessoa.versaoModelo !== config.versaoModelo) {
      continue;
    }
    if (!Array.isArray(pessoa.embeddings) || !Array.isArray(pessoa.media)) {
      continue;
    }
    validas.push(pessoa);
  }

  return validas;
}

/**
 * Retorna a lista sanitizada para exposição via API pública GET /pessoas.
 * NUNCA retorna os vetores numéricos de embeddings, em respeito à minimização da LGPD.
 * 
 * @returns {Promise<Array<{id: string, nome: string, criadoEm: string, versaoModelo: string}>>}
 */
async function listarPessoasPublico() {
  const supabase = obterSupabase();
  const config = obterConfig();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('pessoas')
        .select('*');

      if (error) {
        console.error('[STORAGE-SUPABASE] Erro ao listar do Supabase:', error.message);
      } else if (Array.isArray(data)) {
        return data
          .filter(p => p.softdelet !== true && !p.delete_at)
          .map(p => ({
            id: p.id,
            nome: p.nome,
            criadoEm: p.timerstamp || p.criado_em || new Date().toISOString(),
            versaoModelo: p.versao_modelo || config.versaoModelo
          }))
          .reverse();
      }
    } catch (erro) {
      console.error('[STORAGE-SUPABASE] Exceção ao listar pessoas:', erro.message);
    }
  }

  // Fallback local
  const todas = lerArquivoPessoas();
  return todas.map(p => ({
    id: p.id,
    nome: p.nome,
    criadoEm: p.criadoEm,
    versaoModelo: p.versaoModelo
  }));
}

/**
 * Cadastra uma nova pessoa com seu embedding biométrico.
 * Grava diretamente no Supabase com suporte aos esquemas novo e anterior.
 * 
 * @param {object} dados
 * @param {string} dados.nome
 * @param {boolean} dados.consentimento
 * @param {Array<Array<number>>} dados.embeddings - 5 vetores capturados
 * @param {Array<number>} dados.media - vetor médio de matching
 * @returns {Promise<object>} Registro criado
 */
async function adicionarPessoa({ nome, consentimento, embeddings, media }) {
  if (!nome || typeof nome !== 'string' || !nome.trim()) {
    throw new Error('O nome é obrigatório para o cadastro.');
  }
  if (consentimento !== true) {
    throw new Error('O consentimento explícito (LGPD) é obrigatório.');
  }
  if (!Array.isArray(embeddings) || embeddings.length !== 5) {
    throw new Error('São necessárias exatamente 5 capturas para o cadastro.');
  }
  if (!Array.isArray(media) || media.length === 0 || media.length !== embeddings[0].length) {
    throw new Error(`Vetor médio inválido ou com dimensionalidade incompatível (${media ? media.length : 0}).`);
  }

  const config = obterConfig();
  const supabase = obterSupabase();
  let novaPessoa = null;

  if (supabase) {
    try {
      // 1. Tenta gravar no novo schema com as colunas requisitadas
      let res = await supabase
        .from('pessoas')
        .insert({
          nome: nome.trim(),
          embedding: media,
          timerstamp: new Date().toISOString(),
          softdelet: false,
          delete_at: null
        })
        .select()
        .single();

      // 2. Se a tabela no Supabase ainda estiver com o schema inicial (colunas diferentes), usa as colunas iniciais
      if (res.error && res.error.message && res.error.message.includes("Could not find the")) {
        res = await supabase
          .from('pessoas')
          .insert({
            nome: nome.trim(),
            consentimento: true,
            versao_modelo: config.versaoModelo,
            embeddings,
            media
          })
          .select()
          .single();
      }

      if (res.error) {
        console.warn('[STORAGE-SUPABASE] Falha ao registrar no Supabase:', res.error.message, '- Usando armazenamento local.');
      } else if (res.data) {
        const data = res.data;
        novaPessoa = {
          id: data.id,
          nome: data.nome,
          criadoEm: data.timerstamp || data.criado_em || new Date().toISOString(),
          versaoModelo: data.versao_modelo || config.versaoModelo,
          embeddings,
          media
        };
        console.log(`[STORAGE-SUPABASE] Nova pessoa cadastrada no Supabase: "${novaPessoa.nome}" (ID: ${novaPessoa.id})`);
      }
    } catch (erroSupabase) {
      console.warn('[STORAGE-SUPABASE] Exceção ao tentar registrar no Supabase:', erroSupabase.message, '- Ativando fallback local.');
    }
  }

  // Fallback local se o Supabase não estiver configurado ou se a gravação no Supabase falhou
  if (!novaPessoa) {
    novaPessoa = {
      id: crypto.randomUUID ? crypto.randomUUID() : `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      nome: nome.trim(),
      criadoEm: new Date().toISOString(),
      consentimento: true,
      versaoModelo: config.versaoModelo,
      embeddings,
      media
    };
    console.log(`[STORAGE-LOCAL] Nova pessoa cadastrada localmente: "${novaPessoa.nome}" (ID: ${novaPessoa.id})`);
  }

  // Mantém cópia de segurança em disco local
  try {
    const pessoas = lerArquivoPessoas();
    pessoas.push(novaPessoa);
    salvarArquivoPessoas(pessoas);
  } catch (e) {
    console.warn('[STORAGE] Aviso ao persistir cache local:', e.message);
  }

  return {
    id: novaPessoa.id,
    nome: novaPessoa.nome,
    criadoEm: novaPessoa.criadoEm,
    versaoModelo: novaPessoa.versaoModelo
  };
}

/**
 * Exclui uma pessoa cadastrada pelo ID utilizando Soft Delete no Supabase.
 * Define softdelet = true e delete_at = data atual.
 * 
 * @param {string} id 
 * @returns {Promise<boolean>} true se excluiu, false se não encontrou
 */
async function excluirPessoa(id) {
  if (!id) return false;
  const supabase = obterSupabase();
  let sucessoSupabase = false;

  if (supabase) {
    try {
      // Tenta soft delete com as novas colunas
      let res = await supabase
        .from('pessoas')
        .update({
          softdelet: true,
          delete_at: new Date().toISOString()
        })
        .eq('id', id)
        .select();

      // Se der erro por coluna inexistente no schema atual, faz hard delete
      if (res.error && res.error.message && res.error.message.includes("Could not find the")) {
        res = await supabase
          .from('pessoas')
          .delete()
          .eq('id', id);
      }

      if (res.error) {
        console.error('[STORAGE-SUPABASE] Erro ao excluir no Supabase:', res.error.message);
      } else {
        console.log(`[STORAGE-SUPABASE] Exclusão aplicada no Supabase para ID: ${id}`);
        sucessoSupabase = true;
      }
    } catch (erro) {
      console.error('[STORAGE-SUPABASE] Falha na exclusão:', erro.message);
    }
  }

  // Remove também do arquivo local
  const pessoas = lerArquivoPessoas();
  const indice = pessoas.findIndex(p => p.id === id);
  let sucessoLocal = false;

  if (indice !== -1) {
    const [removida] = pessoas.splice(indice, 1);
    salvarArquivoPessoas(pessoas);
    console.log(`[STORAGE-LOCAL] Pessoa removida do cache local: "${removida.nome}" (ID: ${id})`);
    sucessoLocal = true;
  }

  return supabase ? (sucessoSupabase || sucessoLocal) : sucessoLocal;
}

module.exports = {
  obterPessoasParaComparacao,
  listarPessoasPublico,
  adicionarPessoa,
  excluirPessoa,
  inicializarStorage
};
