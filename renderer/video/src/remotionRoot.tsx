import { Composition } from "remotion";
import { VideoComposition, type VideoCompositionProps } from "./VideoComposition";
import { createProject, projectDuration } from "./projectModel";

const defaultProject = createProject();

export function RemotionRoot() {
  return (
    <Composition
      id="LiftCodeVideo"
      component={VideoComposition}
      width={defaultProject.preset.width}
      height={defaultProject.preset.height}
      fps={defaultProject.fps}
      durationInFrames={1}
      defaultProps={{ project: defaultProject }}
      calculateMetadata={({ props }) => ({
        width: props.project.preset.width,
        height: props.project.preset.height,
        fps: props.project.fps,
        durationInFrames: projectDuration(props.project),
      })}
    />
  );
}
