/**
 * =============================================================================
 * FACE ACCESS - tests/test_embedding.js
 * Testes Unitários de Invariância, Discriminação com Limiar Conservador (0.05)
 * e Imunidade a Variações de Expressão (Exclusão de Boca e Sobrancelhas)
 * =============================================================================
 */

const assert = require('assert');
const {
  normalizar,
  distancia,
  distanciaMediaPorPonto,
  similaridadeCosseno,
  distanciaCosseno,
  media,
  salvarReferencia,
  NUM_PONTOS_ESTAVEIS,
  DIMENSAO_VETOR_LANDMARKS,
  INDICES_PONTOS_ESTAVEIS
} = require('../server/embedding');

console.log('================================================================');
console.log('BATERIA DE TESTES MATEMÁTICOS DE PONTOS ESTÁVEIS (FACE ACCESS)');
console.log(`Dimensão dos Embeddings: ${DIMENSAO_VETOR_LANDMARKS}D (${NUM_PONTOS_ESTAVEIS} pontos ósseos)`);
console.log('================================================================\n');

const LIMIAR_PADRAO_LANDMARKS = 0.050; // Limiar conservador para evitar falsos aceites

/**
 * Gera um conjunto realista de 478 landmarks MediaPipe
 */
function gerarRostoSintetico(variacaoY = 1.0, variacaoX = 1.0) {
  const pontos = [];
  for (let i = 0; i < 478; i++) {
    const theta = (i / 468) * Math.PI * 2;
    const phi = ((i % 50) / 50) * Math.PI - (Math.PI / 2);

    let x = 0.5 + 0.25 * Math.cos(phi) * Math.sin(theta) * variacaoX;
    let y = 0.5 + 0.35 * Math.sin(phi) * variacaoY;
    let z = 0.15 * Math.cos(phi) * Math.cos(theta);

    if (i === 33) {
      x = 0.38; y = 0.45; z = 0.05;
    } else if (i === 263) {
      x = 0.62; y = 0.45; z = 0.05;
    } else if (i === 168) {
      x = 0.50; y = 0.48; z = 0.12;
    }

    pontos.push({ x, y, z });
  }
  return pontos;
}

function aplicarTransformacaoRigida(pontos, anguloGraus, escala, tx, ty, tz) {
  const rad = (anguloGraus * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  return pontos.map(p => {
    const rx = cosA * p.x + sinA * p.z;
    const ry = p.y;
    const rz = -sinA * p.x + cosA * p.z;
    return {
      x: rx * escala + tx,
      y: ry * escala + ty,
      z: rz * escala + tz
    };
  });
}

// -----------------------------------------------------------------------------
// TESTE 1: Invariância de Translação, Rotação e Escala -> Distância < Limiar (0.05)
// -----------------------------------------------------------------------------
console.log('-> TESTE 1: Mesma Pessoa Transformada deve ficar ABAIXO do Limiar (< 0.05)');

const pessoaA_Original = gerarRostoSintetico(1.0, 1.0);
const resBase = normalizar(pessoaA_Original, null);
salvarReferencia(resBase.pontosNormalizados);

const normA = normalizar(pessoaA_Original);
assert.strictEqual(normA.vetor.length, DIMENSAO_VETOR_LANDMARKS, `Esperado vetor de ${DIMENSAO_VETOR_LANDMARKS} dimensões.`);

// Aplica rotação de 15 graus, escala de 3.2x e translação
const pessoaA_Movimentada = aplicarTransformacaoRigida(pessoaA_Original, 15.0, 3.2, 150.0, -90.0, 300.0);
const normA_Movimentada = normalizar(pessoaA_Movimentada);

const distMesmaPessoa = distanciaMediaPorPonto(normA.vetor, normA_Movimentada.vetor);
console.log(`   Distância mesma pessoa transformada: ${distMesmaPessoa.toFixed(6)}`);
console.log(`   Limiar de corte: ${LIMIAR_PADRAO_LANDMARKS}`);

assert(
  distMesmaPessoa < LIMIAR_PADRAO_LANDMARKS,
  `FALHA: A mesma pessoa transformada (${distMesmaPessoa}) deveria ficar abaixo do limiar (${LIMIAR_PADRAO_LANDMARKS}).`
);
console.log('   [OK] Mesma pessoa reconhecida com sucesso (distância < 0.05).\n');

// -----------------------------------------------------------------------------
// TESTE 2: Rosto Diferente (Impostor) deve ficar ACIMA do Limiar (> 0.05)
// -----------------------------------------------------------------------------
console.log('-> TESTE 2: Indivíduo Diferente (Impostor) deve ficar ACIMA do Limiar (> 0.05)');

// Gera pessoa B com morfologia craniofacial substancialmente diferente
function gerarOutroIndividuo() {
  const pontos = [];
  for (let i = 0; i < 478; i++) {
    const theta = (i / 468) * Math.PI * 2;
    const phi = ((i % 50) / 50) * Math.PI - (Math.PI / 2);

    let x = 0.5 + 0.38 * Math.cos(phi) * Math.sin(theta);
    let y = 0.5 + 0.20 * Math.sin(phi);
    let z = 0.28 * Math.cos(phi) * Math.cos(theta);

    if (i === 33) {
      x = 0.30; y = 0.42; z = 0.08;
    } else if (i === 263) {
      x = 0.70; y = 0.42; z = 0.08;
    } else if (i === 168) {
      x = 0.50; y = 0.44; z = 0.20;
    }

    pontos.push({ x, y, z });
  }
  return pontos;
}

const pessoaB_Outro = gerarOutroIndividuo();
const normB = normalizar(pessoaB_Outro);

const distPessoaDiferente = distanciaMediaPorPonto(normA.vetor, normB.vetor);
console.log(`   Distância para outra pessoa: ${distPessoaDiferente.toFixed(6)}`);
console.log(`   Limiar de corte: ${LIMIAR_PADRAO_LANDMARKS}`);

assert(
  distPessoaDiferente > LIMIAR_PADRAO_LANDMARKS,
  `FALHA: Rosto diferente (${distPessoaDiferente}) deveria ficar acima do limiar (${LIMIAR_PADRAO_LANDMARKS}).`
);
console.log('   [OK] Rosto diferente barrado com sucesso (distância > 0.05).\n');

// -----------------------------------------------------------------------------
// TESTE 3: Imunidade a Variações de Expressão (Sorriso/Boca Alterados)
// -----------------------------------------------------------------------------
console.log('-> TESTE 3: Imunidade a Variações de Boca e Sobrancelhas');

const INDICES_BOCA_E_SOBRANCELHAS = new Set([
  0, 11, 12, 13, 14, 15, 16, 17, 61, 78, 80, 81, 82, 87, 88, 91, 95, 146, 178, 185, 291, 308, 310, 311, 312, 317, 318, 324, 375, 402, 415,
  70, 63, 105, 66, 107, 336, 296, 334, 293, 300
]);

const pessoaA_Sorriso = pessoaA_Original.map((p, idx) => {
  if (INDICES_BOCA_E_SOBRANCELHAS.has(idx)) {
    return { x: p.x + 0.15, y: p.y - 0.20, z: p.z + 0.05 };
  }
  return { ...p };
});

const normA_Sorriso = normalizar(pessoaA_Sorriso);
const distComSorriso = distanciaMediaPorPonto(normA.vetor, normA_Sorriso.vetor);
console.log(`   Distância entre expressão neutra e sorriso: ${distComSorriso.toFixed(6)}`);

assert(
  distComSorriso < 1e-5,
  `FALHA: Alterações na boca não deveriam afetar o embedding dos pontos estáveis (obtido: ${distComSorriso}).`
);
console.log('   [OK] Exclusão da boca comprovada matematicamente (distância = 0.000000).\n');

// -----------------------------------------------------------------------------
// TESTE 4: Teste de Similaridade de Cosseno (Modo Modelo Neural)
// -----------------------------------------------------------------------------
console.log('-> TESTE 4: Métrica de Cosseno para Modo Modelo');

const vet1 = new Array(512).fill(0).map((_, i) => Math.sin(i));
const vet2 = new Array(512).fill(0).map((_, i) => Math.sin(i)); // idêntico
const vet3 = new Array(512).fill(0).map((_, i) => -Math.sin(i)); // oposto

const cosIdentico = similaridadeCosseno(vet1, vet2);
const distCosIdentico = distanciaCosseno(vet1, vet2);
assert(Math.abs(cosIdentico - 1.0) < 1e-6);
assert(distCosIdentico < 1e-6);

const cosOposto = similaridadeCosseno(vet1, vet3);
assert(Math.abs(cosOposto - (-1.0)) < 1e-6);

console.log('   [OK] Métrica de similaridade e distância de cosseno validada.\n');

console.log('================================================================');
console.log('TODOS OS TESTES DE ROSTO SINTÉTICO E PONTOS ESTÁVEIS PASSARAM!');
console.log('================================================================\n');
