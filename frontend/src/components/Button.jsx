const VARIANT = { accent: "btn-accent", glass: "glass", ghost: "btn-ghost", danger: "btn-danger" };
// On a coarse pointer (touch) the compact sizes still grow to the 44px minimum.
const ROUND_SIZE = { sm: "!h-9 !w-9 [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!w-11", md: "", lg: "!h-12 !w-12" };
const SMALL = "!min-h-9 !px-3.5 text-small [@media(pointer:coarse)]:!min-h-11";

// Pill button. `as` lets it render a router Link while keeping the same look.
export function Button({ as: Tag = "button", variant = "glass", small, className = "", ...props }) {
  return <Tag className={`btn ${VARIANT[variant]} ${small ? SMALL : ""} ${className}`} {...props} />;
}

// Icon-only button. `label` is required: it becomes the aria-label and tooltip.
// When rendering a standard <button>, default type to "button" so it does not submit forms by accident.
export function IconButton({ as: Tag = "button", label, variant = "ghost", size = "md", className = "", children, type, ...props }) {
  const buttonType = Tag === "button" ? (type ?? "button") : type;
  return (
    <Tag aria-label={label} title={label} type={buttonType} className={`btn-round ${VARIANT[variant]} ${ROUND_SIZE[size]} ${className}`} {...props}>
      {children}
    </Tag>
  );
}
