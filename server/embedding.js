/**
 * =============================================================================
 * FACE ACCESS - server/embedding.js
 * Módulo de Normalização Geométrica e Extração de Embeddings Faciais
 * =============================================================================
 * 
 * REGRAS DE PONTOS ESTÁVEIS:
 * Para evitar falsos aceites provocados por variações de expressão (sorrisos, fala),
 * selecionamos ESTRITAMENTE 94 pontos anatômicos ósseos e estruturais:
 *   - Contorno do crânio / mandíbula
 *   - Nariz e ponte nasal
 *   - Contornos orbitais rígidos dos olhos
 *   - Região malar / zigomática (maçãs do rosto)
 * 
 * SÃO EXCLUÍDOS EXPRESSAMENTE:
 *   - Boca e lábios (muito deformáveis e móveis)
 *   - Sobrancelhas (alta mobilidade de expressão)
 *   - Íris (pontos 468 a 477)
 * 
 * Dimensionalidade do vetor: 94 pontos * 3 coordenadas = 282 números reais.
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// LISTA DOCUMENTADA DE ÍNDICES ESTÁVEIS (94 PONTOS ÓSSEOS)
// =============================================================================
const INDICES_NARIZ = [1, 2, 4, 5, 6, 19, 94, 98, 168, 195, 197, 236, 327, 456];
const INDICES_OLHO_DIR = [7, 33, 133, 144, 145, 153, 154, 155, 157, 158, 159, 160, 161, 163, 173, 246];
const INDICES_OLHO_ESQ = [249, 263, 362, 373, 374, 380, 381, 382, 384, 385, 386, 387, 388, 390, 398, 466];
const INDICES_CONTORNO = [
  10, 21, 54, 58, 67, 93, 103, 109, 127, 132, 136, 148, 149, 150, 152, 162, 172,
  176, 234, 251, 284, 288, 297, 323, 332, 338, 356, 361, 365, 377, 378, 379, 389,
  397, 400, 454
];
const INDICES_MALAR = [116, 123, 147, 192, 213, 214, 345, 352, 376, 416, 433, 434];

// Conjunto unificado e ordenado de marcos rígidos (94 índices únicos)
const INDICES_PONTOS_ESTAVEIS = Array.from(new Set([
  ...INDICES_NARIZ,
  ...INDICES_OLHO_DIR,
  ...INDICES_OLHO_ESQ,
  ...INDICES_CONTORNO,
  ...INDICES_MALAR
])).sort((a, b) => a - b);

const NUM_PONTOS_ESTAVEIS = INDICES_PONTOS_ESTAVEIS.length; // 94
const DIMENSAO_VETOR_LANDMARKS = NUM_PONTOS_ESTAVEIS * 3;   // 282
const CAMINHO_REFERENCIA = path.join(__dirname, '..', 'data', 'referencia.json');

// Mapeamento das posições locais dentro do subvetor estável
const INDICE_LOCAL_OLHO_DIR = INDICES_PONTOS_ESTAVEIS.indexOf(33);
const INDICE_LOCAL_OLHO_ESQ = INDICES_PONTOS_ESTAVEIS.indexOf(263);
const INDICE_LOCAL_PONTE_NARIZ = INDICES_PONTOS_ESTAVEIS.indexOf(168);

let rostoReferenciaGlobal = null;

// =============================================================================
// 1. CARREGAMENTO E GERENCIAMENTO DO ROSTO DE REFERÊNCIA
// =============================================================================

function carregarReferencia() {
  if (rostoReferenciaGlobal) return rostoReferenciaGlobal;
  try {
    if (fs.existsSync(CAMINHO_REFERENCIA)) {
      const conteudo = fs.readFileSync(CAMINHO_REFERENCIA, 'utf-8');
      const dados = JSON.parse(conteudo);
      if (Array.isArray(dados) && dados.length === NUM_PONTOS_ESTAVEIS) {
        rostoReferenciaGlobal = dados;
        return rostoReferenciaGlobal;
      }
    }
  } catch (erro) {
    console.warn('[EMBEDDING] Aviso ao ler referencia.json:', erro.message);
  }
  return null;
}

function salvarReferencia(pontosNormalizados) {
  try {
    const dir = path.dirname(CAMINHO_REFERENCIA);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CAMINHO_REFERENCIA, JSON.stringify(pontosNormalizados, null, 2), 'utf-8');
    rostoReferenciaGlobal = pontosNormalizados;
    console.log(`[EMBEDDING] Rosto de referência salvo em data/referencia.json (${NUM_PONTOS_ESTAVEIS} pontos estáveis).`);
  } catch (erro) {
    console.error('[EMBEDDING] Erro ao salvar referencia.json:', erro.message);
  }
}

carregarReferencia();

// =============================================================================
// 2. OPERAÇÕES DE ÁLGEBRA LINEAR 3D
// =============================================================================

function sub3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add3(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function multEscalar3(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function norma3(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function unitario3(v) {
  const n = norma3(v);
  if (n < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

function cross3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function rotacionarPonto(p, R) {
  return {
    x: R[0][0] * p.x + R[0][1] * p.y + R[0][2] * p.z,
    y: R[1][0] * p.x + R[1][1] * p.y + R[1][2] * p.z,
    z: R[2][0] * p.x + R[2][1] * p.y + R[2][2] * p.z
  };
}

// =============================================================================
// 3. PIPELINE DE NORMALIZAÇÃO DOS PONTOS ESTÁVEIS
// =============================================================================

function centralizarPontos(pontos) {
  const n = pontos.length;
  let somaX = 0, somaY = 0, somaZ = 0;

  for (let i = 0; i < n; i++) {
    somaX += pontos[i].x;
    somaY += pontos[i].y;
    somaZ += pontos[i].z;
  }

  const centroide = { x: somaX / n, y: somaY / n, z: somaZ / n };
  const pontosCentralizados = pontos.map(p => ({
    x: p.x - centroide.x,
    y: p.y - centroide.y,
    z: p.z - centroide.z
  }));

  return { pontosCentralizados, centroide };
}

function normalizarEscala(pontosCentralizados) {
  const n = pontosCentralizados.length;
  let somaDistanciasQuadradas = 0;

  for (let i = 0; i < n; i++) {
    const p = pontosCentralizados[i];
    somaDistanciasQuadradas += (p.x * p.x + p.y * p.y + p.z * p.z);
  }

  const fatorEscala = Math.sqrt(somaDistanciasQuadradas / n);
  if (fatorEscala < 1e-9) {
    throw new Error('Fator de escala degenerado (rosto inválido).');
  }

  const pontosEscalados = pontosCentralizados.map(p => ({
    x: p.x / fatorEscala,
    y: p.y / fatorEscala,
    z: p.z / fatorEscala
  }));

  return { pontosEscalados, fatorEscala };
}

function alinharPorBaseCanonica(pontos) {
  const p33 = pontos[INDICE_LOCAL_OLHO_DIR];
  const p263 = pontos[INDICE_LOCAL_OLHO_ESQ];
  const p168 = pontos[INDICE_LOCAL_PONTE_NARIZ];

  if (!p33 || !p263 || !p168) return pontos;

  const dirOlhos = sub3(p263, p33);
  const uX = unitario3(dirOlhos);
  const pMedioOlhos = multEscalar3(add3(p33, p263), 0.5);
  const dirNariz = sub3(p168, pMedioOlhos);

  let uZ = unitario3(cross3(uX, dirNariz));
  if (norma3(uZ) < 1e-6) uZ = { x: 0, y: 0, z: 1 };
  const uY = unitario3(cross3(uZ, uX));

  const R = [
    [uX.x, uX.y, uX.z],
    [uY.x, uY.y, uY.z],
    [uZ.x, uZ.y, uZ.z]
  ];

  return pontos.map(p => rotacionarPonto(p, R));
}

function alinharProcrustesKabsch(P, Q) {
  const n = Math.min(P.length, Q.length);
  if (n === 0) return P;

  const H = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];

  for (let i = 0; i < n; i++) {
    const p = P[i];
    const q = Q[i];
    H[0][0] += p.x * q.x; H[0][1] += p.x * q.y; H[0][2] += p.x * q.z;
    H[1][0] += p.y * q.x; H[1][1] += p.y * q.y; H[1][2] += p.y * q.z;
    H[2][0] += p.z * q.x; H[2][1] += p.z * q.y; H[2][2] += p.z * q.z;
  }

  const A = [
    H[1][2] - H[2][1],
    H[2][0] - H[0][2],
    H[0][1] - H[1][0]
  ];

  const trH = H[0][0] + H[1][1] + H[2][2];

  const M = [
    [trH, A[0], A[1], A[2]],
    [A[0], H[0][0] - H[1][1] - H[2][2], H[0][1] + H[1][0], H[2][0] + H[0][2]],
    [A[1], H[0][1] + H[1][0], -H[0][0] + H[1][1] - H[2][2], H[1][2] + H[2][1]],
    [A[2], H[2][0] + H[0][2], H[1][2] + H[2][1], -H[0][0] - H[1][1] + H[2][2]]
  ];

  let q = [1.0, 0.0, 0.0, 0.0];
  const MAX_ITERACOES = 40;

  for (let iter = 0; iter < MAX_ITERACOES; iter++) {
    const proximoQ = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        proximoQ[r] += M[r][c] * q[c];
      }
    }

    const normaQ = Math.sqrt(
      proximoQ[0] * proximoQ[0] +
      proximoQ[1] * proximoQ[1] +
      proximoQ[2] * proximoQ[2] +
      proximoQ[3] * proximoQ[3]
    );

    if (normaQ < 1e-12) break;
    for (let k = 0; k < 4; k++) q[k] = proximoQ[k] / normaQ;
  }

  const [q0, q1, q2, q3] = q;
  const R = [
    [1 - 2 * (q2 * q2 + q3 * q3), 2 * (q1 * q2 - q0 * q3), 2 * (q1 * q3 + q0 * q2)],
    [2 * (q1 * q2 + q0 * q3), 1 - 2 * (q1 * q1 + q3 * q3), 2 * (q2 * q3 - q0 * q1)],
    [2 * (q1 * q3 - q0 * q2), 2 * (q2 * q3 + q0 * q1), 1 - 2 * (q1 * q1 + q2 * q2)]
  ];

  return P.map(p => rotacionarPonto(p, R));
}

function vetorizar(pontos) {
  const vetor = new Array(pontos.length * 3);
  for (let i = 0; i < pontos.length; i++) {
    vetor[i * 3] = pontos[i].x;
    vetor[i * 3 + 1] = pontos[i].y;
    vetor[i * 3 + 2] = pontos[i].z;
  }
  return vetor;
}

/**
 * Normaliza os marcos faciais extraindo ESTRITAMENTE os 94 pontos estáveis
 */
function normalizar(rawLandmarks, referenciaPersonalizada = null) {
  if (!Array.isArray(rawLandmarks) || rawLandmarks.length < 468) {
    throw new Error('Entrada inválida: array com landmarks faciais incompleto.');
  }

  // 1. Extração estrita dos 94 pontos estáveis (exclui boca, lábios e sobrancelhas)
  const pontosEstaveis = new Array(NUM_PONTOS_ESTAVEIS);
  for (let i = 0; i < NUM_PONTOS_ESTAVEIS; i++) {
    const idxReal = INDICES_PONTOS_ESTAVEIS[i];
    const p = rawLandmarks[idxReal];
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number' ||
        !isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) {
      throw new Error(`Ponto estável índice ${idxReal} inválido.`);
    }
    pontosEstaveis[i] = { x: p.x, y: p.y, z: p.z };
  }

  // 2. Translação (Centróide na origem)
  const { pontosCentralizados } = centralizarPontos(pontosEstaveis);

  // 3. Normalização de Escala (RMS = 1)
  const { pontosEscalados } = normalizarEscala(pontosCentralizados);

  // 4. Alinhamento canônico anatômico (olhos 33 e 263, nariz 168)
  let pontosAlinhados = alinharPorBaseCanonica(pontosEscalados);

  // 5. Alinhamento de Procrustes/Kabsch contra a referência padrão
  const referencia = referenciaPersonalizada || carregarReferencia();
  if (referencia && Array.isArray(referencia) && referencia.length === NUM_PONTOS_ESTAVEIS) {
    pontosAlinhados = alinharProcrustesKabsch(pontosAlinhados, referencia);
  }

  // 6. Concatenação em vetor
  const vetor = vetorizar(pontosAlinhados);

  return {
    vetor,
    pontosNormalizados: pontosAlinhados
  };
}

// =============================================================================
// 4. MÉTRICAS DE DISTÂNCIA E SIMILARIDADE
// =============================================================================

function distancia(a, b) {
  if (!a || !b || a.length !== b.length) {
    throw new Error('Vetores incompatíveis para distância euclidiana.');
  }
  let soma = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    const diff = a[i] - b[i];
    soma += diff * diff;
  }
  return Math.sqrt(soma);
}

/**
 * Distância média por ponto (RMSD 3D) calculada sobre os 94 pontos estáveis:
 * D_ponto = D / sqrt(94) = sqrt( (1/94) * sum( ||p_a - p_b||^2 ) )
 */
function distanciaMediaPorPonto(a, b) {
  const distTotal = distancia(a, b);
  return distTotal / Math.sqrt(NUM_PONTOS_ESTAVEIS);
}

/**
 * Similaridade de Cosseno (usada para embeddings neurais de 512 números)
 */
function similaridadeCosseno(a, b) {
  if (!a || !b || a.length !== b.length) {
    throw new Error('Vetores incompatíveis para cálculo de cosseno.');
  }
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA < 1e-12 || normB < 1e-12) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Distância de Cosseno: 1 - cos(a, b)
 */
function distanciaCosseno(a, b) {
  return 1 - similaridadeCosseno(a, b);
}

function media(vetores) {
  if (!Array.isArray(vetores) || vetores.length === 0) {
    throw new Error('Array de vetores vazio para média.');
  }
  const numVetores = vetores.length;
  const dimensao = vetores[0].length;
  const vetorMedio = new Array(dimensao).fill(0);

  for (let i = 0; i < numVetores; i++) {
    const v = vetores[i];
    for (let k = 0; k < dimensao; k++) {
      vetorMedio[k] += v[k];
    }
  }
  for (let k = 0; k < dimensao; k++) {
    vetorMedio[k] /= numVetores;
  }
  return vetorMedio;
}

module.exports = {
  INDICES_PONTOS_ESTAVEIS,
  NUM_PONTOS_ESTAVEIS,
  DIMENSAO_VETOR_LANDMARKS,
  normalizar,
  distancia,
  distanciaMediaPorPonto,
  similaridadeCosseno,
  distanciaCosseno,
  media,
  salvarReferencia,
  carregarReferencia
};
