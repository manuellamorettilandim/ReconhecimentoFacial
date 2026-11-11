/**
 * =============================================================================
 * FACE ACCESS - public/js/acesso.js
 * Lógica do Fluxo de Verificação de Acesso em Tempo Real com Decisão Temporal
 * =============================================================================
 */

import { inicializarFaceLandmarker, processarFrameVideo, desenharLandmarksNoCanvas } from './mediapipe.js';
import { GerenciadorCamera } from './camera.js';
import { calcularEAR, DetectorPiscada, validarPoseFacial } from './face_geometry.js';

// Elementos da Interface DOM
const video = document.getElementById('webcam');
const canvas = document.getElementById('canvasOverlay');
const faceGuide = document.getElementById('faceGuide');
const feedbackBadge = document.getElementById('feedbackBadge');
const statusBadge = document.getElementById('statusBadge');
const cameraAlert = document.getElementById('cameraAlert');

const chkDrawLandmarks = document.getElementById('chkDrawLandmarks');
const chkAutoReset = document.getElementById('chkAutoReset');
const btnReset = document.getElementById('btnReset');

const decisionCard = document.getElementById('decisionCard');
const decisionStatus = document.getElementById('decisionStatus');
const decisionMain = document.getElementById('decisionMain');
const decisionSub = document.getElementById('decisionSub');

const progressFill = document.getElementById('progressFill');
const framesText = document.getElementById('framesText');

const candidatoNome = document.getElementById('candidatoNome');
const candidatoDetalhe = document.getElementById('candidatoDetalhe');
const segundoNome = document.getElementById('segundoNome');
const segundoDetalhe = document.getElementById('segundoDetalhe');
const distanciaMedia10 = document.getElementById('distanciaMedia10');
const limiarValor = document.getElementById('limiarValor');
const modoLabel = document.getElementById('modoLabel');

const earValor = document.getElementById('earValor');
const piscadaBadge = document.getElementById('piscadaBadge');

// Estado interno do reconhecedor
const detectorPiscada = new DetectorPiscada(0.20, 0.25);
let gerenciadorCamera = null;
let reqEmAndamento = false;
let ultimoTimestampEnvio = 0;
const INTERVALO_MIN_ENVIO_MS = 100; // ~10 requisições por segundo

const FRAMES_NECESSARIOS = 10;
let bufferDistancias10 = []; // Buffer com as distâncias dos últimos 10 frames
let ultimoCandidatoId = null;
let acessoLiberado = false;
let limiarServidor = 0.05; // Padrão conservador

let feedbackTextoPersistente = '';
let feedbackCorPersistente = 'rgba(255, 255, 255, 0.2)';

/**
 * Atualiza o cartão visual de decisão
 */
function definirEstadoDecisao(tipo, titulo, principal, detalhe) {
  decisionCard.className = 'decision-card ' + (tipo || '');
  decisionStatus.textContent = titulo;
  decisionMain.textContent = principal;
  decisionSub.textContent = detalhe;

  if (faceGuide) {
    faceGuide.className = 'face-guide-overlay ' + (tipo === 'liberado' ? 'success' : (tipo === 'negado' ? 'danger' : (tipo === 'ok' ? 'ok' : '')));
  }
}

/**
 * Atualiza a barra de progresso temporal (0 a 10)
 */
function atualizarProgressoFrames(qtd) {
  const contagem = Math.min(qtd, FRAMES_NECESSARIOS);
  const pct = (contagem / FRAMES_NECESSARIOS) * 100;
  progressFill.style.width = pct + '%';
  framesText.textContent = `${contagem} / ${FRAMES_NECESSARIOS}`;

  if (contagem >= FRAMES_NECESSARIOS) {
    progressFill.classList.add('full');
  } else {
    progressFill.classList.remove('full');
  }
}

/**
 * Reseta o estado da verificação
 */
function resetarVerificacao() {
  bufferDistancias10 = [];
  ultimoCandidatoId = null;
  acessoLiberado = false;
  feedbackTextoPersistente = '';
  detectorPiscada.resetar();
  atualizarProgressoFrames(0);

  piscadaBadge.className = 'liveness-badge';
  piscadaBadge.textContent = '👁️ Aguardando piscada';
  definirEstadoDecisao('', 'AGUARDANDO ROSTO', 'Aproxime-se', 'Posicione o rosto na moldura central');

  candidatoNome.textContent = '--';
  candidatoNome.className = 'metric-value';
  candidatoDetalhe.textContent = 'd = --';

  if (segundoNome) segundoNome.textContent = '--';
  if (segundoDetalhe) segundoDetalhe.textContent = 'Margem: --';
  if (distanciaMedia10) {
    distanciaMedia10.textContent = '--';
    distanciaMedia10.className = 'metric-value';
  }
}

btnReset.addEventListener('click', resetarVerificacao);

/**
 * Envia os 478 landmarks crus para o backend processar a normalização e comparação
 */
async function enviarParaVerificacao(landmarks) {
  if (reqEmAndamento) return;
  reqEmAndamento = true;

  try {
    const res = await fetch('/verificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ landmarks })
    });

    if (!res.ok) {
      throw new Error(`Erro do servidor (${res.status})`);
    }

    const data = await res.json();
    processarRespostaVerificacao(data);
  } catch (erro) {
    console.warn('[VERIFICAR] Falha na requisição:', erro.message);
  } finally {
    reqEmAndamento = false;
  }
}

/**
 * Processa a resposta da biometria e implementa a REGRA DE DECISÃO TEMPORAL (Média dos 10 frames)
 */
function processarRespostaVerificacao(resposta) {
  if (acessoLiberado) return;

  if (resposta.limiar) {
    limiarServidor = resposta.limiar;
    limiarValor.textContent = resposta.limiar.toFixed(3);
  }

  // Base de dados vazia
  if (!resposta.candidatos || resposta.candidatos.length === 0) {
    definirEstadoDecisao('negado', 'ACESSO NEGADO', 'Pessoa Não Cadastrada', 'Nenhum rosto cadastrado no sistema. Cadastre ao menos um rosto na aba "Novo Cadastro".');
    candidatoNome.textContent = 'Pessoa Não Cadastrada';
    candidatoNome.className = 'metric-value bad';
    candidatoDetalhe.textContent = 'Base de dados vazia';
    if (distanciaMedia10) distanciaMedia10.textContent = '--';
    feedbackTextoPersistente = '❌ Acesso Negado: Pessoa Não Cadastrada';
    feedbackCorPersistente = 'var(--danger)';
    bufferDistancias10 = [];
    atualizarProgressoFrames(0);
    return;
  }

  // Atualiza exibição do 2º Candidato e Margem (Requisito 1 e 3)
  if (segundoNome) {
    segundoNome.textContent = resposta.nomeSegundo || 'Nenhum';
  }
  if (segundoDetalhe) {
    if (resposta.distanciaSegundo !== null && resposta.razaoMargem !== null) {
      const margemOk = resposta.margemAtendida;
      segundoDetalhe.innerHTML = `d = ${resposta.distanciaSegundo.toFixed(4)} | Margem: <strong style="color: ${margemOk ? 'var(--success)' : 'var(--danger)'}">${resposta.razaoMargem}x</strong> ${margemOk ? '✅' : '⚠️ (<1.3x)'}`;
    } else {
      segundoDetalhe.textContent = 'Apenas 1 pessoa na base';
    }
  }

  const dInstantanea = resposta.distancia;
  const candidatoIdAtual = resposta.candidatos[0].pessoaId;
  const candidatoNomeAtual = resposta.candidatos[0].nome;

  // Mostra distância instantânea no detalhe
  candidatoDetalhe.textContent = `d instantânea = ${dInstantanea.toFixed(4)}`;

  // Gerenciamento do Buffer dos 10 frames da mesma pessoa (Requisito 3)
  if (candidatoIdAtual === ultimoCandidatoId) {
    bufferDistancias10.push(dInstantanea);
    if (bufferDistancias10.length > FRAMES_NECESSARIOS) {
      bufferDistancias10.shift();
    }
  } else {
    // Mudou de candidato detectado: reinicia o buffer temporal
    ultimoCandidatoId = candidatoIdAtual;
    bufferDistancias10 = [dInstantanea];
  }

  // Calcula a média das distâncias acumuladas no buffer (Requisito 3)
  const somaDist = bufferDistancias10.reduce((acc, val) => acc + val, 0);
  const mediaTemporal10 = somaDist / bufferDistancias10.length;

  if (distanciaMedia10) {
    distanciaMedia10.textContent = mediaTemporal10.toFixed(4);
  }

  atualizarProgressoFrames(bufferDistancias10.length);

  // A decisão final de aprovação é tomada quando temos os 10 frames acumulados:
  if (bufferDistancias10.length >= FRAMES_NECESSARIOS) {
    const mediaPassouLimiar = mediaTemporal10 < limiarServidor;
    const margemPassou = resposta.margemAtendida;

    if (mediaPassouLimiar && margemPassou) {
      // Candidato aprovado pela média dos 10 frames!
      candidatoNome.textContent = candidatoNomeAtual;
      candidatoNome.className = 'metric-value good';
      if (distanciaMedia10) distanciaMedia10.className = 'metric-value good';

      if (detectorPiscada.piscadaDetectada) {
        acessoLiberado = true;
        definirEstadoDecisao(
          'liberado',
          'ACESSO LIBERADO',
          `Bem-vindo(a), ${candidatoNomeAtual}!`,
          `Média 10 frames: ${mediaTemporal10.toFixed(4)} < Limiar ${limiarServidor.toFixed(3)} | Margem segura: ${resposta.razaoMargem || 1.3}x | Liveness OK.`
        );
        feedbackTextoPersistente = `✅ Acesso Liberado: ${candidatoNomeAtual}`;
        feedbackCorPersistente = 'var(--success)';

        if (chkAutoReset.checked) {
          setTimeout(() => {
            resetarVerificacao();
          }, 4500);
        }
      } else {
        definirEstadoDecisao(
          'ok',
          'PROVA DE VIDA NECESSÁRIA',
          'Pisque os Olhos',
          `Rosto reconhecido com média ${mediaTemporal10.toFixed(4)}. Pisque os olhos para liberar o acesso.`
        );
        feedbackTextoPersistente = '👁️ Rosto reconhecido • Pisque os olhos!';
        feedbackCorPersistente = 'var(--accent-amber)';
      }
    } else {
      // Falhou na média dos 10 frames ou falhou na margem -> PESSOA NÃO CADASTRADA
      candidatoNome.textContent = 'Pessoa Não Cadastrada';
      candidatoNome.className = 'metric-value bad';
      if (distanciaMedia10) distanciaMedia10.className = 'metric-value bad';

      let motivo = '';
      if (!mediaPassouLimiar) {
        motivo = `Média dos 10 frames (${mediaTemporal10.toFixed(4)}) excede o limiar (${limiarServidor.toFixed(3)}).`;
      } else {
        motivo = `Ambiguidade biométrica: margem (${resposta.razaoMargem}x) menor que o mínimo seguro (1.3x).`;
      }

      definirEstadoDecisao('negado', 'ACESSO NEGADO', 'Pessoa Não Cadastrada', motivo);
      feedbackTextoPersistente = '❌ Acesso Negado: Pessoa Não Cadastrada';
      feedbackCorPersistente = 'var(--danger)';

      // Zera para forçar nova tentativa contínua
      bufferDistancias10.shift();
      atualizarProgressoFrames(bufferDistancias10.length);
    }
  } else {
    // Acumulando frames: exibe feedback de análise em progresso
    if (dInstantanea < limiarServidor && resposta.margemAtendida) {
      candidatoNome.textContent = candidatoNomeAtual;
      candidatoNome.className = 'metric-value good';
      if (distanciaMedia10) distanciaMedia10.className = 'metric-value good';

      definirEstadoDecisao(
        'ok',
        'ESTABILIZANDO BIOMETRIA',
        `Analisando: ${candidatoNomeAtual}`,
        `Acumulando média temporal: ${bufferDistancias10.length}/10 frames (d instantânea: ${dInstantanea.toFixed(4)})`
      );
      feedbackTextoPersistente = `👁️ Estabilizando: ${candidatoNomeAtual} (${bufferDistancias10.length}/10)`;
      feedbackCorPersistente = 'var(--accent-cyan)';
    } else {
      candidatoNome.textContent = 'Pessoa Não Cadastrada';
      candidatoNome.className = 'metric-value bad';
      if (distanciaMedia10) distanciaMedia10.className = 'metric-value bad';

      definirEstadoDecisao(
        'negado',
        'ACESSO NEGADO',
        'Pessoa Não Cadastrada',
        `Distância (${dInstantanea.toFixed(4)}) excede o limiar seguro (${limiarServidor.toFixed(3)}).`
      );
      feedbackTextoPersistente = '❌ Acesso Negado: Pessoa Não Cadastrada';
      feedbackCorPersistente = 'var(--danger)';
    }
  }
}

/**
 * Loop principal de inferência em tempo real
 */
async function loopVerificacao() {
  if (!gerenciadorCamera.ativo) return;

  const tempoAtual = performance.now();
  const resultado = processarFrameVideo(video, tempoAtual);

  gerenciadorCamera.limparCanvas();

  const faces = resultado.faceLandmarks || [];

  if (faces.length === 0) {
    feedbackTextoPersistente = '';
    feedbackBadge.textContent = 'Posicione o rosto na moldura central';
    feedbackBadge.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    if (!acessoLiberado) {
      definirEstadoDecisao('', 'AGUARDANDO ROSTO', 'Aproxime-se', 'Nenhum rosto visível na câmera');
      bufferDistancias10 = [];
      atualizarProgressoFrames(0);
    }
  } else if (faces.length >= 2) {
    feedbackTextoPersistente = '❌ Múltiplos rostos detectados!';
    feedbackBadge.textContent = feedbackTextoPersistente;
    feedbackBadge.style.borderColor = 'var(--danger)';
    definirEstadoDecisao(
      'negado',
      'ACESSO NEGADO',
      'Múltiplos Rostos',
      'Segurança violada: mais de um rosto detectado no enquadramento.'
    );
    bufferDistancias10 = [];
    atualizarProgressoFrames(0);
  } else {
    const landmarks = faces[0];

    if (chkDrawLandmarks.checked) {
      desenharLandmarksNoCanvas(gerenciadorCamera.ctx, landmarks);
    }

    const ear = calcularEAR(landmarks);
    earValor.textContent = ear.toFixed(3);

    detectorPiscada.atualizar(ear);
    if (detectorPiscada.piscadaDetectada) {
      piscadaBadge.className = 'liveness-badge active';
      piscadaBadge.textContent = '✅ Piscada detectada';
    }

    const checagemPose = validarPoseFacial(landmarks);

    if (!checagemPose.ok) {
      feedbackBadge.textContent = '⚠️ ' + checagemPose.mensagem;
      feedbackBadge.style.borderColor = 'var(--warning)';
      if (!acessoLiberado) {
        definirEstadoDecisao('', 'ENQUADRAMENTO', checagemPose.mensagem, 'Ajuste sua posição diante da webcam');
        bufferDistancias10 = [];
        atualizarProgressoFrames(0);
      }
    } else {
      if (feedbackTextoPersistente) {
        feedbackBadge.textContent = feedbackTextoPersistente;
        feedbackBadge.style.borderColor = feedbackCorPersistente;
      } else {
        feedbackBadge.textContent = '👁️ Pose adequada • Analisando biometria...';
        feedbackBadge.style.borderColor = 'var(--accent-cyan)';
      }

      if (!acessoLiberado && (tempoAtual - ultimoTimestampEnvio) > INTERVALO_MIN_ENVIO_MS) {
        ultimoTimestampEnvio = tempoAtual;
        const coordenadas = landmarks.map(p => ({ x: p.x, y: p.y, z: p.z }));
        enviarParaVerificacao(coordenadas);
      }
    }
  }

  requestAnimationFrame(loopVerificacao);
}

/**
 * Inicialização do módulo
 */
async function iniciarApp() {
  try {
    gerenciadorCamera = new GerenciadorCamera(video, canvas, (msgErro) => {
      cameraAlert.textContent = '⚠️ ' + msgErro;
      cameraAlert.style.display = 'flex';
      statusBadge.textContent = '🔴 Falha na Câmera';
    });

    try {
      const respCfg = await fetch('/config');
      if (respCfg.ok) {
        const dadosCfg = await respCfg.json();
        limiarServidor = dadosCfg.limiar;
        limiarValor.textContent = limiarServidor.toFixed(3);
        if (modoLabel) {
          modoLabel.textContent = `Modo: ${dadosCfg.modoEmbedding === 'modelo' ? 'MobileFaceNet ONNX' : '94 Pontos Estáveis'}`;
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar config:', e);
    }

    await inicializarFaceLandmarker((status) => {
      statusBadge.textContent = status;
    });
    statusBadge.textContent = '🟢 MediaPipe Operacional';
    statusBadge.style.borderColor = 'var(--success)';

    await gerenciadorCamera.iniciar();
    requestAnimationFrame(loopVerificacao);
  } catch (erro) {
    console.error('[ACESSO] Erro inicial:', erro);
    statusBadge.textContent = '🔴 Erro de Inicialização';
  }
}

window.addEventListener('DOMContentLoaded', iniciarApp);
