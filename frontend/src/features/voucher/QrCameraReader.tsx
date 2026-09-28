import jsQR from "jsqr";
import { useEffect, useRef } from "react";

// Cada cuánto se intenta leer un cuadro. 5 por segundo alcanza para que se
// sienta instantáneo en un mostrador, sin tener el CPU del celular al 100%.
const INTERVALO_MS = 200;

// Ancho máximo del cuadro que se le pasa a jsQR: la cámara trasera de un
// celular da 1080p o más, y decodificar eso entero cada 200 ms es lento sin
// leer mejor un QR que ocupa buena parte de la imagen.
const ANCHO_MAXIMO_PX = 640;

export interface QrCameraReaderProps {
  // Se llama con el texto de CADA cuadro en que se lee un QR — mientras el
  // mismo código siga frente a la cámara, varias veces por segundo. Quien lo
  // usa decide qué repetición ignorar.
  onDecode: (texto: string) => void;
  // Sin cámara, sin permiso o sin getUserMedia (http, navegador viejo). Se
  // llama una sola vez; el componente no reintenta.
  onUnavailable: (motivo: string) => void;
}

// ---------------------------------------------------------------------------
// Lector de QR con la cámara (ítem 178): getUserMedia + jsQR, sin video de
// terceros. Cámara trasera si hay (facingMode "environment"). La corta al
// desmontarse — sin esto el celular deja la luz de la cámara prendida.
//
// Aislado en su propio componente para que la pantalla de escaneo se pruebe
// mockeándolo: jsdom no tiene cámara ni canvas.
// ---------------------------------------------------------------------------
export function QrCameraReader({ onDecode, onUnavailable }: QrCameraReaderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // En refs para que un callback nuevo en cada render no reinicie la cámara.
  const onDecodeRef = useRef(onDecode);
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    onDecodeRef.current = onDecode;
    onUnavailableRef.current = onUnavailable;
  });

  useEffect(() => {
    let cancelado = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    const canvas = document.createElement("canvas");
    const contexto = canvas.getContext("2d", { willReadFrequently: true });

    function leerCuadro() {
      if (cancelado) return;
      const video = videoRef.current;
      if (video && contexto && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        const escala = Math.min(1, ANCHO_MAXIMO_PX / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * escala);
        canvas.height = Math.round(video.videoHeight * escala);
        contexto.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imagen = contexto.getImageData(0, 0, canvas.width, canvas.height);
        const codigo = jsQR(imagen.data, imagen.width, imagen.height, {
          inversionAttempts: "dontInvert",
        });
        if (codigo?.data) onDecodeRef.current(codigo.data);
      }
      timer = window.setTimeout(leerCuadro, INTERVALO_MS);
    }

    async function iniciar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        onUnavailableRef.current("Este navegador no da acceso a la cámara.");
        return;
      }
      try {
        const obtenido = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelado) {
          obtenido.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = obtenido;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = obtenido;
        await video.play();
        leerCuadro();
      } catch (error) {
        if (cancelado) return;
        onUnavailableRef.current(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "No se dio permiso para usar la cámara."
            : "No pudimos abrir la cámara.",
        );
      }
    }

    void iniciar();
    return () => {
      cancelado = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <video ref={videoRef} className="ds-voucher-scan-video" muted playsInline aria-label="Cámara" />
  );
}
