/**
 * =============================================================================
 * FACE ACCESS - public/js/mediapipe.js
 * Inicializador e Wrapper do MediaPipe Face Landmarker (@mediapipe/tasks-vision)
 * =============================================================================
 */

import {
  FaceLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

let faceLandmarker = null;
let drawingUtils = null;

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

/**
 * Inicializa o modelo de visão computacional do MediaPipe no navegador.
 * @param {function(string): void} onStatusCallback - Callback para status na UI
 * @returns {Promise<FaceLandmarker>}
 */
export async function inicializarFaceLandmarker(onStatusCallback = () => {}) {
  if (faceLandmarker) return faceLandmarker;

  try {
    onStatusCallback('Baixando componentes WASM do MediaPipe...');
    const filesetResolver = await FilesetResolver.forVisionTasks(WASM_URL);

    onStatusCallback('Carregando modelo neural Face Landmarker (478 pontos)...');
    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU' // Usa WebGL / GPU do navegador se disponível
      },
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
      runningMode: 'VIDEO',
      numFaces: 2 // Permite detectar múltiplos rostos para barrar invasão de tela
    });

    onStatusCallback('Modelo MediaPipe pronto!');
    return faceLandmarker;
  } catch (erro) {
    console.error('[MEDIAPIPE] Erro fatal ao inicializar:', erro);
    onStatusCallback('Erro ao carregar MediaPipe: ' + erro.message);
    throw erro;
  }
}

/**
 * Executa inferência no frame atual do vídeo da webcam.
 * @param {HTMLVideoElement} video 
 * @param {number} timestampMs 
 * @returns {object} Resultado do FaceLandmarker com array de faces detectadas
 */
export function processarFrameVideo(video, timestampMs) {
  if (!faceLandmarker || video.readyState < 2) {
    return { faceLandmarks: [] };
  }

  return faceLandmarker.detectForVideo(video, timestampMs);
}

/**
 * Desenha a malha facial no canvas sobreposto.
 * @param {CanvasRenderingContext2D} ctx 
 * @param {Array<object>} landmarks 
 * @param {boolean} desenharConectores 
 */
export function desenharLandmarksNoCanvas(ctx, landmarks, desenharConectores = true) {
  if (!ctx || !landmarks || landmarks.length === 0) return;

  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  ctx.save();

  // Desenha os pontos anatômicos como círculos luminosos
  ctx.fillStyle = '#06b6d4'; // Ciano neon
  for (let i = 0; i < 468; i++) {
    const pt = landmarks[i];
    const px = pt.x * width;
    const py = pt.y * height;

    ctx.beginPath();
    ctx.arc(px, py, 1.2, 0, 2 * Math.PI);
    ctx.fill();
  }

  // Destaque nos pontos de cálculo de EAR (olhos) e referência canônica (33, 263, 168)
  const pontosDestaque = [33, 263, 168, 1, 152, 160, 158, 133, 153, 144, 385, 387, 373, 380];
  ctx.fillStyle = '#34d399'; // Verde esmeralda para pontos estáveis
  for (const idx of pontosDestaque) {
    const pt = landmarks[idx];
    if (pt) {
      const px = pt.x * width;
      const py = pt.y * height;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  ctx.restore();
}
