/**
 * =============================================================================
 * FACE ACCESS - public/js/calibracao.js
 * Lógica da Calibração Automática de Limiar com Percentis e Taxas de Erro (FAR/FRR)
 * =============================================================================
 */

import { inicializarFaceLandmarker, processarFrameVideo, desenharLandmarksNoCanvas } from './mediapipe.js';
import { GerenciadorCamera } from './camera.js';
import { validarPoseFacial } from './face_geometry.js';

const video = document.getElementById('webcam');
const canvas = document.getElementById('canvasOverlay');
const feedbackBadge = document.getElementById('feedbackBadge');
const statusBadge = document.getElementById('statusBadge');
const cameraAlert = document.getElementById('cameraAlert');
const listaDistanciasTempoReal = document.getElementById('listaDistanciasTempoReal');

const valorLimiarAtual = document.getElementById('valorLimiarAtual');
const sliderLimiar = document.getElementById('sliderLimiar');
const modoDesc = document.getElementById('modoDesc');
const btnSalvarLimiar = document.getElementById('btnSalvarLimiar');
const btnAplicarSugerido = document.getElementById('btnAplicarSugerido');
const selectModo = document.getElementById('selectModo');

const farValor = document.getElementById('farValor');
const frrValor = document.getElementById('frrValor');

const btnAmostraEu = document.getElementById('btnAmostraEu');
const btnAmostraOutro = document.getElementById('btnAmostraOutro');
const btnLimparAmostras = document.getElementById('btnLimparAmostras');

const qtdEu = document.getElementById('qtdEu');
const minEu = document.getElementById('minEu');
const medEu = document.getElementById('medEu');
const p95Eu = document.getElementById('p95Eu');

const qtdOutro = document.getElementById('qtdOutro');
const minOutro = document.getElementById('minOutro');
const medOutro = document.getElementById('medOutro');
const p5Outro = document.getElementById('p5Outro');

const boxSugestao = document.getElementById('boxSugestao');

let gerenciadorCamera = null;
let reqEmAndamento = false;
let menorDistanciaAtual = null;
let limiarConfig = 0.05;
let limiarSugeridoCalculado = null;
let modoAtual = 'landmarks';

const amostrasEu = [];
const amostrasOutro = [];

// =============================================================================
// CÁLCULO DE PERCENTIS E TAXAS DE ERRO (FAR / FRR)
// =============================================================================

function calcularPercentil(array, p) {
  if (!array || array.length === 0) return 0;
  const ordenado = [...array].sort((a, b) => a - b);
  const pos = (p / 100) * (ordenado.length - 1);
  const base = Math.floor(pos);
  const resto = pos - base;
  if (ordenado[base + 1] !== undefined) {
    return ordenado[base] + resto * (ordenado[base + 1] - ordenado[base]);
  }
  return ordenado[base];
}

function calcularTaxasErro(limiarTeste) {
  // FAR: percentual de impostores aceitos (distância < limiar)
  let far = 0;
  if (amostrasOutro.length > 0) {
    const aceitosImpostores = amostrasOutro.filter(d => d < limiarTeste).length;
    far = (aceitosImpostores / amostrasOutro.length) * 100;
  }

  // FRR: percentual de genuínos rejeitados (distância >= limiar)
  let frr = 0;
  if (amostrasEu.length > 0) {
    const rejeitadosGenuinos = amostrasEu.filter(d => d >= limiarTeste).length;
    frr = (rejeitadosGenuinos / amostrasEu.length) * 100;
  }

  return { far, frr };
}

function atualizarExibicaoTaxasErro() {
  const limiarAtual = parseFloat(sliderLimiar.value);
  const { far, frr } = calcularTaxasErro(limiarAtual);

  farValor.textContent = `${far.toFixed(1)}%`;
  farValor.style.color = far > 0 ? '#f87171' : '#34d399';

  frrValor.textContent = `${frr.toFixed(1)}%`;
  frrValor.style.color = frr > 0 ? '#fbbf24' : '#34d399';
}

function atualizarPainelEstatisticas() {
  // Genuínas ("Sou Eu")
  qtdEu.textContent = amostrasEu.length;
  if (amostrasEu.length > 0) {
    minEu.textContent = Math.min(...amostrasEu).toFixed(4);
    medEu.textContent = (amostrasEu.reduce((a, b) => a + b, 0) / amostrasEu.length).toFixed(4);
    const p95 = calcularPercentil(amostrasEu, 95);
    p95Eu.textContent = p95.toFixed(4);
  } else {
    minEu.textContent = '--';
    medEu.textContent = '--';
    p95Eu.textContent = '--';
  }

  // Impostoras ("É Outro")
  qtdOutro.textContent = amostrasOutro.length;
  if (amostrasOutro.length > 0) {
    minOutro.textContent = Math.min(...amostrasOutro).toFixed(4);
    medOutro.textContent = (amostrasOutro.reduce((a, b) => a + b, 0) / amostrasOutro.length).toFixed(4);
    const p5 = calcularPercentil(amostrasOutro, 5);
    p5Outro.textContent = p5.toFixed(4);
  } else {
    minOutro.textContent = '--';
    medOutro.textContent = '--';
    p5Outro.textContent = '--';
  }

  // Sugestão automática por P95 e P5 (Requisito 2)
  if (amostrasEu.length >= 3 && amostrasOutro.length >= 3) {
    const p95Val = calcularPercentil(amostrasEu, 95);
    const p5Val = calcularPercentil(amostrasOutro, 5);
    const sugerido = parseFloat(((p95Val + p5Val) / 2).toFixed(4));
    limiarSugeridoCalculado = sugerido;
    btnAplicarSugerido.disabled = false;

    const { far, frr } = calcularTaxasErro(sugerido);

    if (p95Val < p5Val) {
      boxSugestao.innerHTML = `
        🎯 <strong>Separação Ótima com Margem Positiva!</strong><br>
        P95 Genuíno: <strong>${p95Val.toFixed(4)}</strong> | P5 Impostor: <strong>${p5Val.toFixed(4)}</strong>.<br>
        Limiar sugerido: <strong style="color: var(--accent-cyan); font-size: 1.15rem;">${sugerido}</strong>.<br>
        Nesse ponto: <strong>FAR = ${far.toFixed(1)}%</strong> | <strong>FRR = ${frr.toFixed(1)}%</strong>.
      `;
    } else {
      boxSugestao.innerHTML = `
        ⚠️ <strong>Sobreposição de Caudas Detectada:</strong><br>
        P95 Genuíno (${p95Val.toFixed(4)}) &gt; P5 Impostor (${p5Val.toFixed(4)}).<br>
        Ponto médio sugerido: <strong style="color: var(--warning); font-size: 1.15rem;">${sugerido}</strong> (FAR = ${far.toFixed(1)}% | FRR = ${frr.toFixed(1)}%).<br>
        <em>Dica didática: evite movimentos bruscos nas amostras genuínas.</em>
      `;
    }
  } else {
    btnAplicarSugerido.disabled = true;
    boxSugestao.innerHTML = `
      💡 <strong>Instrução Didática:</strong> Registre ao menos 3 amostras de "Sou Eu" e 3 de "É Outro" para calcular o limiar ótimo entre P95 e P5.
    `;
  }

  atualizarExibicaoTaxasErro();
}

// =============================================================================
// CARREGAMENTO E SINCRONIZAÇÃO DE CONFIGURAÇÃO
// =============================================================================

async function carregarConfigServidor() {
  try {
    const res = await fetch('/config');
    if (res.ok) {
      const dados = await res.json();
      limiarConfig = dados.limiar;
      modoAtual = dados.modoEmbedding || 'landmarks';

      selectModo.value = modoAtual;
      configurarSliderParaModo(modoAtual);

      sliderLimiar.value = limiarConfig;
      valorLimiarAtual.textContent = limiarConfig.toFixed(3);
    }
  } catch (e) {
    console.warn('[CALIBRACAO] Erro ao carregar config:', e);
  }
}

function configurarSliderParaModo(modo) {
  if (modo === 'modelo') {
    sliderLimiar.min = '0.10';
    sliderLimiar.max = '0.60';
    sliderLimiar.step = '0.01';
    modoDesc.textContent = 'Modo: MobileFaceNet ONNX (Distância de Cosseno)';
  } else {
    sliderLimiar.min = '0.010';
    sliderLimiar.max = '0.150';
    sliderLimiar.step = '0.002';
    modoDesc.textContent = 'Modo: 94 Pontos Estáveis (RMSD Euclidiano)';
  }
}

sliderLimiar.addEventListener('input', () => {
  const val = parseFloat(sliderLimiar.value);
  valorLimiarAtual.textContent = val.toFixed(4);
  atualizarExibicaoTaxasErro();
});

selectModo.addEventListener('change', () => {
  const novoModo = selectModo.value;
  configurarSliderParaModo(novoModo);
  const novoPadrao = novoModo === 'modelo' ? 0.35 : 0.05;
  sliderLimiar.value = novoPadrao;
  valorLimiarAtual.textContent = novoPadrao.toFixed(3);
});

btnSalvarLimiar.addEventListener('click', async () => {
  const novoLimiar = parseFloat(sliderLimiar.value);
  const modoEscolhido = selectModo.value;

  try {
    const res = await fetch('/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limiar: novoLimiar,
        modoEmbedding: modoEscolhido
      })
    });
    const resultado = await res.json();
    if (res.ok) {
      limiarConfig = resultado.config.limiar;
      alert(`✅ Configuração salva com sucesso no servidor!\nLimiar = ${limiarConfig}\nModo = ${resultado.config.modoEmbedding}`);
    } else {
      alert('Erro: ' + resultado.erro);
    }
  } catch (e) {
    alert('Erro de conexão: ' + e.message);
  }
});

btnAplicarSugerido.addEventListener('click', () => {
  if (limiarSugeridoCalculado !== null) {
    sliderLimiar.value = limiarSugeridoCalculado;
    valorLimiarAtual.textContent = limiarSugeridoCalculado.toFixed(4);
    atualizarExibicaoTaxasErro();
  }
});

btnAmostraEu.addEventListener('click', () => {
  if (menorDistanciaAtual === null) {
    alert('Aproxime o rosto da câmera e aguarde o enquadramento.');
    return;
  }
  amostrasEu.push(menorDistanciaAtual);
  atualizarPainelEstatisticas();
});

btnAmostraOutro.addEventListener('click', () => {
  if (menorDistanciaAtual === null) {
    alert('Aproxime o rosto da câmera e aguarde o enquadramento.');
    return;
  }
  amostrasOutro.push(menorDistanciaAtual);
  atualizarPainelEstatisticas();
});

btnLimparAmostras.addEventListener('click', () => {
  amostrasEu.length = 0;
  amostrasOutro.length = 0;
  limiarSugeridoCalculado = null;
  btnAplicarSugerido.disabled = true;
  atualizarPainelEstatisticas();
});

// =============================================================================
// LOOP DE PROCESSAMENTO E RENDERIZAÇÃO EM TEMPO REAL
// =============================================================================

async function enviarParaComparacao(landmarks) {
  if (reqEmAndamento) return;
  reqEmAndamento = true;

  try {
    const res = await fetch('/verificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ landmarks })
    });

    if (res.ok) {
      const dados = await res.json();
      renderizarDistanciasCandidatos(dados);
    }
  } catch (e) {
    console.warn('[CALIBRACAO] Falha ao verificar:', e.message);
  } finally {
    reqEmAndamento = false;
  }
}

function renderizarDistanciasCandidatos(dados) {
  if (!dados.candidatos || dados.candidatos.length === 0) {
    listaDistanciasTempoReal.innerHTML = `
      <div style="color: var(--warning); font-size: 0.95rem;">
        ⚠️ Nenhum cadastro na base com a versão atual de modelo. <a href="cadastro.html" style="color: #38bdf8;">Cadastre um rosto primeiro</a>.
      </div>
    `;
    menorDistanciaAtual = null;
    return;
  }

  menorDistanciaAtual = dados.distancia;
  const limiarAtual = parseFloat(sliderLimiar.value);

  let html = '';
  dados.candidatos.forEach(c => {
    const d = c.distancia;
    const maxEscala = modoAtual === 'modelo' ? 0.6 : 0.15;
    const pct = Math.min(100, Math.round((d / maxEscala) * 100));
    const passou = d < limiarAtual;
    const cor = passou ? 'var(--success)' : 'var(--danger)';

    html += `
      <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.75rem;">
        <div style="display: flex; justify-content: space-between; font-size: 0.95rem;">
          <strong style="color: #fff;">${c.nome}</strong>
          <span style="font-family: monospace; font-weight: 700; color: ${cor};">
            d = ${d.toFixed(4)} ${passou ? '(PASSOU < LIMIAR)' : '(RECUSADO >= LIMIAR)'}
          </span>
        </div>
        <div class="dist-bar-track">
          <div class="dist-bar-fill" style="width: ${pct}%; background: ${cor};"></div>
        </div>
      </div>
    `;
  });

  listaDistanciasTempoReal.innerHTML = html;
}

let ultimoTimestampCalib = 0;

function loopCalibracao() {
  if (!gerenciadorCamera || !gerenciadorCamera.ativo) return;

  const tempoAtual = performance.now();
  const resultado = processarFrameVideo(video, tempoAtual);

  gerenciadorCamera.limparCanvas();

  const faces = resultado.faceLandmarks || [];

  if (faces.length === 0) {
    feedbackBadge.textContent = 'Nenhum rosto visível';
    feedbackBadge.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    menorDistanciaAtual = null;
  } else if (faces.length >= 2) {
    feedbackBadge.textContent = '❌ Múltiplos rostos detectados';
    feedbackBadge.style.borderColor = 'var(--danger)';
    menorDistanciaAtual = null;
  } else {
    const landmarks = faces[0];
    desenharLandmarksNoCanvas(gerenciadorCamera.ctx, landmarks);

    const checagem = validarPoseFacial(landmarks);
    if (!checagem.ok) {
      feedbackBadge.textContent = '⚠️ ' + checagem.mensagem;
      feedbackBadge.style.borderColor = 'var(--warning)';
    } else {
      feedbackBadge.textContent = '👁️ Rosto posicionado • Calculando distâncias...';
      feedbackBadge.style.borderColor = 'var(--accent-cyan)';

      if (tempoAtual - ultimoTimestampCalib > 120) {
        ultimoTimestampCalib = tempoAtual;
        const coordenadas = landmarks.map(p => ({ x: p.x, y: p.y, z: p.z }));
        enviarParaComparacao(coordenadas);
      }
    }
  }

  requestAnimationFrame(loopCalibracao);
}

async function iniciarCalibracao() {
  try {
    gerenciadorCamera = new GerenciadorCamera(video, canvas, (erro) => {
      cameraAlert.textContent = '⚠️ ' + erro;
      cameraAlert.style.display = 'flex';
      statusBadge.textContent = '🔴 Falha na Câmera';
    });

    await carregarConfigServidor();

    statusBadge.textContent = '🟡 Carregando MediaPipe...';
    await inicializarFaceLandmarker((status) => {
      statusBadge.textContent = status;
    });
    statusBadge.textContent = '🟢 Pronto para Calibração';

    await gerenciadorCamera.iniciar();
    requestAnimationFrame(loopCalibracao);
  } catch (e) {
    console.error('[CALIBRACAO] Erro inicial:', e);
  }
}

window.addEventListener('DOMContentLoaded', iniciarCalibracao);
