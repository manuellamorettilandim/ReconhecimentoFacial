/**
 * =============================================================================
 * FACE ACCESS - public/js/face_geometry.js
 * Geometria Facial no Cliente: EAR (Piscada / Liveness) e Validação de Pose
 * =============================================================================
 */

// Índices canônicos dos olhos na malha de 478 landmarks do MediaPipe:
// Olho Esquerdo:
// 33: canto externo, 160: superior 1, 158: superior 2, 133: canto interno, 153: inferior 2, 144: inferior 1
const OLHO_ESQUERDO_INDICES = {
  p1: 33,  // canto lateral externo
  p2: 160, // pálpebra superior ext
  p3: 158, // pálpebra superior int
  p4: 133, // canto medial interno
  p5: 153, // pálpebra inferior int
  p6: 144  // pálpebra inferior ext
};

// Olho Direito:
// 362: canto interno, 385: superior 1, 387: superior 2, 263: canto externo, 373: inferior 2, 380: inferior 1
const OLHO_DIREITO_INDICES = {
  p1: 362, // canto medial interno
  p2: 385, // pálpebra superior int
  p3: 387, // pálpebra superior ext
  p4: 263, // canto lateral externo
  p5: 373, // pálpebra inferior ext
  p6: 380  // pálpebra inferior int
};

/**
 * Distância Euclidiana 2D entre dois landmarks (em pixels ou coordenadas normalizadas)
 */
function dist2D(pA, pB) {
  const dx = pA.x - pB.x;
  const dy = pA.y - pB.y;
  return Math.hypot(dx, dy);
}

/**
 * Calcula o Eye Aspect Ratio (EAR) para um conjunto de 6 pontos do olho:
 * EAR = (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)
 * 
 * @param {Array<object>} landmarks 
 * @param {object} indices 
 * @returns {number}
 */
function calcularEARIndividual(landmarks, indices) {
  const p1 = landmarks[indices.p1];
  const p2 = landmarks[indices.p2];
  const p3 = landmarks[indices.p3];
  const p4 = landmarks[indices.p4];
  const p5 = landmarks[indices.p5];
  const p6 = landmarks[indices.p6];

  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0;

  const vertical1 = dist2D(p2, p6);
  const vertical2 = dist2D(p3, p5);
  const horizontal = dist2D(p1, p4);

  if (horizontal < 1e-6) return 0;

  return (vertical1 + vertical2) / (2.0 * horizontal);
}

/**
 * Calcula o EAR médio de ambos os olhos.
 * Valores típicos:
 * - Olho aberto: 0.25 a 0.38
 * - Olho piscando (fechado): < 0.18 a 0.20
 * 
 * @param {Array<object>} landmarks 
 * @returns {number}
 */
export function calcularEAR(landmarks) {
  const earEsq = calcularEARIndividual(landmarks, OLHO_ESQUERDO_INDICES);
  const earDir = calcularEARIndividual(landmarks, OLHO_DIREITO_INDICES);
  return (earEsq + earDir) / 2.0;
}

/**
 * Detector de Piscada com máquina de estados para evitar falsos positivos
 */
export class DetectorPiscada {
  constructor(limiarFechado = 0.20, limiarAberto = 0.25) {
    this.limiarFechado = limiarFechado;
    this.limiarAberto = limiarAberto;
    this.estadoOlho = 'ABERTO'; // 'ABERTO' ou 'FECHANDO'
    this.piscadaDetectada = false;
    this.totalPiscadas = 0;
  }

  /**
   * Atualiza com o EAR do frame atual e verifica transição de piscada
   * @param {number} earAtual 
   * @returns {boolean} true se acabou de completar uma piscada
   */
  atualizar(earAtual) {
    let acabouDePiscar = false;

    if (this.estadoOlho === 'ABERTO') {
      if (earAtual < this.limiarFechado) {
        this.estadoOlho = 'FECHANDO';
      }
    } else if (this.estadoOlho === 'FECHANDO') {
      if (earAtual >= this.limiarAberto) {
        this.estadoOlho = 'ABERTO';
        this.piscadaDetectada = true;
        this.totalPiscadas++;
        acabouDePiscar = true;
      }
    }

    return acabouDePiscar;
  }

  resetar() {
    this.piscadaDetectada = false;
    this.estadoOlho = 'ABERTO';
  }
}

/**
 * Validação de qualidade de pose e enquadramento:
 * - Verifica se a face tem tamanho suficiente na tela (proximidade).
 * - Verifica se a cabeça está voltada de frente (yaw e pitch razoáveis).
 * 
 * @param {Array<object>} landmarks 
 * @returns {{ ok: boolean, mensagem: string, tamanhoRelativo: number }}
 */
export function validarPoseFacial(landmarks) {
  if (!landmarks || landmarks.length < 468) {
    return { ok: false, mensagem: 'Landmarks incompletos', tamanhoRelativo: 0 };
  }

  const p33 = landmarks[33];   // olho direito
  const p263 = landmarks[263]; // olho esquerdo
  const p1 = landmarks[1];     // ponta do nariz
  const p168 = landmarks[168]; // topo do nariz
  const p152 = landmarks[152]; // ponta do queixo

  // 1. Verificação de Tamanho Mínimo (distância entre olhos na tela normalizada 0..1)
  const distOlhos = dist2D(p33, p263);
  if (distOlhos < 0.14) {
    return {
      ok: false,
      mensagem: 'Aproxime-se mais da câmera para validação segura.',
      tamanhoRelativo: distOlhos
    };
  }

  // 2. Verificação de Rotação Horizontal (Yaw)
  // O nariz deve estar aproximadamente equidistante dos dois olhos
  const distOlhoDirNariz = dist2D(p33, p1);
  const distOlhoEsqNariz = dist2D(p263, p1);
  const razaoSimetria = distOlhoDirNariz / (distOlhoEsqNariz + 1e-6);

  if (razaoSimetria < 0.55 || razaoSimetria > 1.8) {
    return {
      ok: false,
      mensagem: 'Olhe diretamente de frente para a câmera.',
      tamanhoRelativo: distOlhos
    };
  }

  // 3. Verificação de Rotação Vertical (Pitch)
  // Nariz não pode estar nem acima da linha dos olhos nem abaixo do queixo
  if (p1.y < p168.y || p1.y > p152.y) {
    return {
      ok: false,
      mensagem: 'Nivele o queixo olhando na altura da lente.',
      tamanhoRelativo: distOlhos
    };
  }

  return {
    ok: true,
    mensagem: 'Enquadramento e pose ideais.',
    tamanhoRelativo: distOlhos
  };
}
