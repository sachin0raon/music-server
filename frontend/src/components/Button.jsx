const VARIANT = { accent: "btn-accent", glass: "glass", ghost: "btn-ghost", danger: "btn-danger" };
// On a coarse pointer (touch) the compact sizes still grow to the 44px minimum.
const ROUND_SIZE = { sm: "!h-9 !w-9 [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!w-11", md: "", lg: "!h-12 !w-12" };
const SMALL = "!min-h-9 !px-3.5 text-small [@media(pointer:coarse)]:!min-h-11";

// Pill button. `as` lets it render a router Link while keeping the same look.
export function Button({ as: Tag = "button", variant = "glass", small, className = "", ...props }) {
  return <Tag className={`btn ${VARIANT[variant]} ${small ? SMALL : ""} ${className}`} {...props} />;
}

// Icon-only button. `label` is required: it becomes the aria-label and tooltip.
export function IconButton({ as: Tag = "button", label, variant = "ghost", size = "md", className = "", children, ...props }) {
  return (
    <Tag aria-label={label} title={label} className={`btn-round ${VARIANT[variant]} ${ROUND_SIZE[size]} ${className}`} {...props}>
      {children}
    </Tag>
  );
}
