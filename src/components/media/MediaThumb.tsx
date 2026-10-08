import type { MediaItem } from '../../db/db';
import { formatDuration, thumbUrl } from '../../media/media';
import { useMediaUI } from '../../media/mediaUI';
import Icon from '../Icon';

/** A square preview of a photo or video. Body photos blur when privacy blur is on. */
export default function MediaThumb({ item, onClick, caption, className = '' }: { item: MediaItem; onClick?: () => void; caption?: string; className?: string }) {
  const blur = useMediaUI((s) => s.blurBody) && item.purpose === 'progress';
  const src = thumbUrl(item);
  return (
    <button className={`mthumb ${blur ? 'blurred' : ''} ${className}`} onClick={onClick} title={caption}>
      {src ? <img src={src} alt="" loading="lazy" /> : <Icon name={item.kind === 'video' ? 'video' : 'image'} />}
      {item.kind === 'video' && (
        <span className="thumb-badge">
          <Icon name="play" size={10} /> {formatDuration(item.duration)}
        </span>
      )}
      {(item.marks?.length ?? 0) > 0 && (
        <span className="thumb-badge left" title="Has measurements">
          <Icon name="angle" size={11} /> {item.marks!.length}
        </span>
      )}
      {caption && <span className="mthumb-cap">{caption}</span>}
    </button>
  );
}
