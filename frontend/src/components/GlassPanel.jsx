const LEVEL = { flat: "glass", raised: "glass-raised", overlay: "glass-overlay", bar: "glass-bar" };

export default function GlassPanel({ as: Tag = "div", level = "flat", className = "", ...props }) {
  return <Tag className={`${LEVEL[level]} rounded-card ${className}`} {...props} />;
}
