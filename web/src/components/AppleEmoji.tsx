// Apple-style emoji images (pinned CDN version) so icons look the same on every OS.
export const EMOJI_CDN = "https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64";

export function AppleEmoji({ code, size = 16, className = "" }: { code: string; size?: number; className?: string }) {
  return (
    <img
      src={`${EMOJI_CDN}/${code}.png`}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
      draggable={false}
      onError={(e) => (e.currentTarget.style.display = "none")}
    />
  );
}
