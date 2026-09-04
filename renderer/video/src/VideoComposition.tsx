import { Video } from "@remotion/media";
import { AbsoluteFill, Html5Audio, Sequence, staticFile } from "remotion";
import { clipDuration, getCoverPlacement, type VideoProject } from "./projectModel";

export type VideoCompositionProps = { project: VideoProject };

const mediaSource = (src: string) => src.startsWith("/assets/") ? staticFile(src.slice(1)) : src;

export function VideoComposition({ project }: VideoCompositionProps) {
  let clipFrom = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: project.backgroundColor, overflow: "hidden" }}>
      {project.clips.map((clip) => {
        const from = clipFrom;
        const durationInFrames = clipDuration(clip);
        const coverPlacement = getCoverPlacement(clip, project.preset);
        clipFrom += durationInFrames;
        return (
          <Sequence key={clip.id} from={from} durationInFrames={durationInFrames} name={clip.name}>
            <Video
              src={mediaSource(clip.src)}
              trimBefore={clip.trimStart}
              trimAfter={clip.trimEnd}
              volume={clip.volume}
              objectFit={clip.fit === "cover" ? "fill" : "contain"}
              style={{
                position: "absolute",
                left: clip.fit === "cover" ? coverPlacement.left : clip.x,
                top: clip.fit === "cover" ? coverPlacement.top : clip.y,
                width: clip.fit === "cover" ? coverPlacement.width : clip.width,
                height: clip.fit === "cover" ? coverPlacement.height : clip.height,
              }}
            />
          </Sequence>
        );
      })}

      {project.textLayers.map((layer) => (
        <Sequence key={layer.id} from={layer.from} durationInFrames={layer.durationInFrames} name={layer.name}>
          <div
            style={{
              position: "absolute",
              left: layer.x,
              top: layer.y,
              width: layer.width,
              boxSizing: "border-box",
              padding: "0.14em 0.22em",
              whiteSpace: "pre-wrap",
              overflowWrap: "break-word",
              fontFamily: layer.fontFamily,
              fontSize: layer.fontSize,
              fontWeight: layer.fontWeight,
              lineHeight: 1.08,
              color: layer.color,
              textAlign: layer.align,
              backgroundColor: `color-mix(in srgb, ${layer.backgroundColor} ${layer.backgroundOpacity * 100}%, transparent)`,
              opacity: layer.opacity,
            }}
          >
            {layer.text}
          </div>
        </Sequence>
      ))}

      {project.audioLayers.map((layer) => (
        <Sequence key={layer.id} from={layer.from} durationInFrames={layer.trimEnd - layer.trimStart} name={layer.name}>
          <Html5Audio
            src={mediaSource(layer.src)}
            trimBefore={layer.trimStart}
            trimAfter={layer.trimEnd}
            volume={layer.volume}
            acceptableTimeShiftInSeconds={1}
            pauseWhenBuffering
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
