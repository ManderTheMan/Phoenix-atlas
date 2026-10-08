// The camera, viewer, comparison and time-lapse screens, drawn above any page.
import { lazy, Suspense } from 'react';
import { useMediaUI } from '../../media/mediaUI';

const CameraSheet = lazy(() => import('./CameraSheet'));
const MediaViewer = lazy(() => import('./MediaViewer'));
const MediaCompare = lazy(() => import('./MediaCompare'));
const Timelapse = lazy(() => import('./Timelapse'));

export default function MediaModals() {
  const { camera, viewer, compare, timelapse } = useMediaUI();
  if (!camera && !viewer && !compare && !timelapse) return null;
  return (
    <Suspense
      fallback={
        <div className="mv">
          <div className="cam-starting">
            <div className="spinner" />
          </div>
        </div>
      }
    >
      {viewer && <MediaViewer key="viewer" id={viewer.id} list={viewer.list} />}
      {compare && <MediaCompare key={`${compare.a}|${compare.b}`} a={compare.a} b={compare.b} />}
      {timelapse && <Timelapse pose={timelapse.pose} />}
      {camera && <CameraSheet req={camera} />}
    </Suspense>
  );
}
