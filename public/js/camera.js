/**
 * =============================================================================
 * FACE ACCESS - public/js/camera.js
 * Gerenciamento de Câmera/Webcam e Canvas de Renderização
 * =============================================================================
 */

export class GerenciadorCamera {
  constructor(videoElement, canvasElement, onErrorCallback = () => {}) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.stream = null;
    this.onError = onErrorCallback;
    this.ativo = false;
  }

  /**
   * Solicita acesso à webcam do usuário e conecta ao elemento <video>
   */
  async iniciar() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const msg = 'Seu navegador não suporta acesso à webcam (getUserMedia). Utilize Chrome, Edge ou Firefox em localhost/HTTPS.';
      this.onError(msg);
      throw new Error(msg);
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });

      this.video.srcObject = this.stream;

      return new Promise((resolve) => {
        this.video.onloadedmetadata = () => {
          this.video.play();
          this.redimensionarCanvas();
          this.ativo = true;
          resolve(true);
        };
      });
    } catch (erro) {
      let mensagem = 'Não foi possível acessar a webcam.';
      if (erro.name === 'NotAllowedError' || erro.name === 'PermissionDeniedError') {
        mensagem = 'Permissão de acesso à câmera negada. Clique no ícone de cadeado na barra de endereços para liberar o acesso.';
      } else if (erro.name === 'NotFoundError' || erro.name === 'DevicesNotFoundError') {
        mensagem = 'Nenhuma câmera ou webcam foi detectada no dispositivo.';
      } else if (erro.name === 'NotReadableError' || erro.name === 'TrackStartError') {
        mensagem = 'A câmera já está sendo usada por outro aplicativo ou navegador.';
      }

      this.onError(mensagem);
      throw erro;
    }
  }

  redimensionarCanvas() {
    if (this.video.videoWidth && this.video.videoHeight) {
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
    }
  }

  limparCanvas() {
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  parar() {
    this.ativo = false;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
    this.limparCanvas();
  }
}
