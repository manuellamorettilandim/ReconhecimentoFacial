/**
 * =============================================================================
 * FACE ACCESS - public/js/cadastro.js
 * Lógica do Cadastro Facial com Consentimento LGPD e 5 Capturas Guiadas
 * =============================================================================
 */

import { inicializarFaceLandmarker, processarFrameVideo, desenharLandmarksNoCanvas } from './mediapipe.js';
import { GerenciadorCamera } from './camera.js';
import { validarPoseFacial } from './face_geometry.js';

// Elementos da Seção 1 (Identificação e LGPD)
const secaoConsentimento = document.getElementById('secaoConsentimento');
const inputNome = document.getElementById('inputNome');
const chkConsentimento = document.getElementById('chkConsentimento');
const btnAvancar = document.getElementById('btnAvancar');

// Elementos da Seção 2 (Capturas com Webcam)
const secaoCaptura = document.getElementById('secaoCaptura');
const video = document.getElementById('webcam');
const canvas = document.getElementById('canvasOverlay');
const chkDrawLandmarks = document.getElementById('chkDrawLandmarks');
const feedbackBadge = document.getElementById('feedbackBadge');
const statusBadge = document.getElementById('statusBadge');
const cameraAlert = document.getElementById('cameraAlert');

const instrucaoNumero = document.getElementById('instrucaoNumero');
const instrucaoTitulo = document.getElementById('instrucaoTitulo');
const instrucaoDesc = document.getElementById('instrucaoDesc');
const statusPoseVal = document.getElementById('statusPoseVal');
const statusPoseDet = document.getElementById('statusPoseDet');
const tamanhoVal = document.getElementById('tamanhoVal');
const btnCapturar = document.getElementById('btnCapturar');
const btnVoltarInicio = document.getElementById('btnVoltarInicio');

// Definição das 5 etapas guiadas
const ETAPAS_CADASTRO = [
  {
    num: '1 DE 5',
    titulo: 'Olhe de frente',
    desc: 'Mantenha os olhos voltados diretamente para a lente com expressão neutra.',
    tipo: 'frontal'
  },
  {
    num: '2 DE 5',
    titulo: 'Vire levemente à esquerda',
    desc: 'Gire suavemente o rosto cerca de 10 a 15 graus para a sua esquerda.',
    tipo: 'esquerda'
  },
  {
    num: '3 DE 5',
    titulo: 'Vire levemente à direita',
    desc: 'Gire suavemente o rosto cerca de 10 a 15 graus para a sua direita.',
    tipo: 'direita'
  },
  {
    num: '4 DE 5',
    titulo: 'Levante um pouco o queixo',
    desc: 'Incline a cabeça suavemente para cima, mantendo o enquadramento.',
    tipo: 'queixo'
  },
  {
    num: '5 DE 5',
    titulo: 'Expressão neutra (Confirmação)',
    desc: 'Olhar firme e natural diretamente para a câmera para fechar o modelo médio.',
    tipo: 'frontal'
  }
];

let passoAtual = 0;
const capturasColetadas = []; // Guardará estritamente os 5 arrays de 478 pontos {x, y, z}
let landmarksAtuais = null;
let poseValidaAgora = false;
let gerenciadorCamera = null;

// =============================================================================
// VALIDAÇÃO DA SEÇÃO 1 (CONSENTIMENTO LGPD)
// =============================================================================

function validarFormularioInicial() {
  const nomeValido = inputNome.value.trim().length >= 2;
  const consentimentoAceito = chkConsentimento.checked;
  btnAvancar.disabled = !(nomeValido && consentimentoAceito);
}

inputNome.addEventListener('input', validarFormularioInicial);
chkConsentimento.addEventListener('change', validarFormularioInicial);

btnAvancar.addEventListener('click', async () => {
  const nome = inputNome.value.trim();
  if (!nome || !chkConsentimento.checked) return;

  // Transição de tela
  secaoConsentimento.style.display = 'none';
  secaoCaptura.style.display = 'block';

  await iniciarFluxoCapturas();
});

btnVoltarInicio.addEventListener('click', () => {
  if (gerenciadorCamera) {
    gerenciadorCamera.parar();
  }
  secaoCaptura.style.display = 'none';
  secaoConsentimento.style.display = 'block';
  passoAtual = 0;
  capturasColetadas.length = 0;
  atualizarCardsPassos();
});

// =============================================================================
// FLUXO DE CAPTURAS GUIADAS
// =============================================================================

function atualizarCardsPassos() {
  for (let i = 0; i < 5; i++) {
    const card = document.getElementById(`stepCard${i}`);
    if (!card) continue;
    card.className = 'step-card';
    if (i < passoAtual) {
      card.classList.add('completed');
    } else if (i === passoAtual) {
      card.classList.add('active');
    }
  }

  if (passoAtual < ETAPAS_CADASTRO.length) {
    const etapa = ETAPAS_CADASTRO[passoAtual];
    instrucaoNumero.textContent = `PASSO ${etapa.num}`;
    instrucaoTitulo.textContent = etapa.titulo;
    instrucaoDesc.textContent = etapa.desc;
  }
}

async function iniciarFluxoCapturas() {
  atualizarCardsPassos();

  try {
    gerenciadorCamera = new GerenciadorCamera(video, canvas, (erroMsg) => {
      cameraAlert.textContent = '⚠️ ' + erroMsg;
      cameraAlert.style.display = 'flex';
      statusBadge.textContent = '🔴 Falha na Câmera';
    });

    statusBadge.textContent = '🟡 Carregando MediaPipe...';
    await inicializarFaceLandmarker((status) => {
      statusBadge.textContent = status;
    });
    statusBadge.textContent = '🟢 Câmera Pronta';

    await gerenciadorCamera.iniciar();
    requestAnimationFrame(loopLoopCaptura);
  } catch (erro) {
    console.error('[CADASTRO] Erro ao iniciar câmera:', erro);
  }
}

/**
 * Loop de verificação geométrica contínua na tela de cadastro
 */
function loopLoopCaptura() {
  if (!gerenciadorCamera || !gerenciadorCamera.ativo) return;

  const tempoAtual = performance.now();
  const resultado = processarFrameVideo(video, tempoAtual);

  gerenciadorCamera.limparCanvas();

  const faces = resultado.faceLandmarks || [];

  if (faces.length === 0) {
    feedbackBadge.textContent = 'Nenhum rosto visível na moldura';
    feedbackBadge.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    statusPoseVal.textContent = 'Sem Rosto';
    statusPoseVal.className = 'metric-value bad';
    statusPoseDet.textContent = 'Posicione-se em frente à câmera';
    tamanhoVal.textContent = '0%';
    poseValidaAgora = false;
    btnCapturar.disabled = true;
  } else if (faces.length >= 2) {
    feedbackBadge.textContent = '❌ Mais de 1 rosto! Fique sozinho(a)';
    feedbackBadge.style.borderColor = 'var(--danger)';
    statusPoseVal.textContent = 'Múltiplos Rostos';
    statusPoseVal.className = 'metric-value bad';
    statusPoseDet.textContent = 'Apenas 1 pessoa permitida';
    poseValidaAgora = false;
    btnCapturar.disabled = true;
  } else {
    // Exatamente 1 rosto
    const landmarks = faces[0];
    landmarksAtuais = landmarks;

    if (chkDrawLandmarks.checked) {
      desenharLandmarksNoCanvas(gerenciadorCamera.ctx, landmarks);
    }

    const checagem = validarPoseFacial(landmarks);
    const pctTamanho = Math.round(checagem.tamanhoRelativo * 100);
    tamanhoVal.textContent = `${pctTamanho}%`;

    // Validação de qualidade específica do passo
    let poseApropriadaParaEtapa = checagem.ok;
    const p33 = landmarks[33];
    const p263 = landmarks[263];
    const p1 = landmarks[1];
    const distEsq = Math.hypot(p263.x - p1.x, p263.y - p1.y);
    const distDir = Math.hypot(p33.x - p1.x, p33.y - p1.y);
    const ratio = distDir / (distEsq + 1e-6);

    const etapa = ETAPAS_CADASTRO[passoAtual];
    if (etapa.tipo === 'esquerda') {
      // Ao virar para a esquerda na imagem espelhada
      poseApropriadaParaEtapa = (checagem.tamanhoRelativo >= 0.14) && (ratio > 0.85);
    } else if (etapa.tipo === 'direita') {
      poseApropriadaParaEtapa = (checagem.tamanhoRelativo >= 0.14) && (ratio < 1.25);
    } else if (etapa.tipo === 'queixo') {
      poseApropriadaParaEtapa = (checagem.tamanhoRelativo >= 0.14);
    }

    if (poseApropriadaParaEtapa) {
      statusPoseVal.textContent = 'Pose Válida';
      statusPoseVal.className = 'metric-value good';
      statusPoseDet.textContent = 'Clique para capturar a amostra';
      feedbackBadge.textContent = '✅ Enquadramento ideal! Pronto para capturar';
      feedbackBadge.style.borderColor = 'var(--success)';
      poseValidaAgora = true;
      btnCapturar.disabled = false;
    } else {
      statusPoseVal.textContent = 'Ajustar Posição';
      statusPoseVal.className = 'metric-value warn';
      statusPoseDet.textContent = checagem.mensagem;
      feedbackBadge.textContent = '⚠️ ' + checagem.mensagem;
      feedbackBadge.style.borderColor = 'var(--warning)';
      poseValidaAgora = false;
      btnCapturar.disabled = true;
    }
  }

  requestAnimationFrame(loopLoopCaptura);
}

// =============================================================================
// BOTÃO DE CAPTURA E ENVIO FINAL AO BACKEND
// =============================================================================

btnCapturar.addEventListener('click', async () => {
  if (!poseValidaAgora || !landmarksAtuais) return;

  // Extrai SOMENTE os números das coordenadas {x, y, z}
  const coordenadasPuras = landmarksAtuais.map(p => ({
    x: p.x,
    y: p.y,
    z: p.z
  }));

  capturasColetadas.push(coordenadasPuras);
  passoAtual++;

  // Efeito sonoro / visual de clique
  feedbackBadge.textContent = `📸 Amostra ${passoAtual}/5 capturada com sucesso!`;
  feedbackBadge.style.borderColor = 'var(--accent-cyan)';

  if (passoAtual < ETAPAS_CADASTRO.length) {
    atualizarCardsPassos();
    btnCapturar.disabled = true;
  } else {
    // Concluiu as 5 capturas!
    atualizarCardsPassos();
    btnCapturar.disabled = true;
    instrucaoNumero.textContent = 'PROCESSANDO';
    instrucaoTitulo.textContent = 'Enviando ao servidor...';
    instrucaoDesc.textContent = 'Normalizando translação, escala e rotação via Procrustes 3D e salvando em JSON.';

    await finalizarCadastro();
  }
});

async function finalizarCadastro() {
  const nome = inputNome.value.trim();

  try {
    statusBadge.textContent = '🟡 Gravando biometria...';

    const resposta = await fetch('/cadastrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome,
        consentimento: true,
        capturas: capturasColetadas
      })
    });

    let resultado = null;
    try {
      resultado = await resposta.json();
    } catch {
      resultado = { erro: `Erro de comunicação com o servidor (HTTP ${resposta.status} ${resposta.statusText})` };
    }

    if (!resposta.ok) {
      throw new Error(resultado?.erro || 'Falha ao realizar cadastro.');
    }

    if (gerenciadorCamera) {
      gerenciadorCamera.parar();
    }

    alert(`🎉 Sucesso! A pessoa "${resultado.pessoa.nome}" foi cadastrada com 5 embeddings normalizados.`);
    window.location.href = 'pessoas.html';
  } catch (erro) {
    console.error('[CADASTRO] Erro no envio:', erro);
    alert('❌ Erro no cadastro: ' + erro.message);
    instrucaoTitulo.textContent = 'Erro no Cadastro';
    instrucaoDesc.textContent = erro.message;
    btnVoltarInicio.style.display = 'block';
  }
}
