import type { useYouTube } from "../useYouTube";

/** Área do vídeo: o player controlável ou, se a API do YouTube falhar, o embed simples. */
export function Player({ videoId, yt }: { videoId: string; yt: ReturnType<typeof useYouTube> }) {
  if (yt.fallback) {
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
        title="Transmissão do debate"
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    );
  }
  return <div ref={yt.ref} className="player-host" />;
}
