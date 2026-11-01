// One row in a menu modal, shared by the track and video menus so the two
// cannot drift apart in height, spacing or focus behaviour.
//
// `as` exists for the download and the source link, which have to be real
// anchors: the session cookie already authorises a download, so the browser
// can own the transfer instead of the page pulling the file into memory, and
// an external link needs to be something the browser can open in a new tab.
export default function MenuItem({ as: Tag = "button", icon: Icon, children, onClick, danger, disabled, label, initialFocus, ...rest }) {
  return (
    <Tag onClick={onClick} disabled={Tag === "button" ? disabled : undefined} aria-label={label}
      data-autofocus={initialFocus ? "" : undefined} {...rest}
      className={`interactive flex min-h-12 w-full items-center gap-3.5 rounded-tile px-2 text-left text-body disabled:opacity-50 ${danger ? "text-danger" : ""}`}>
      <Icon size={22} className={danger ? "" : "text-mute"} />{children}
    </Tag>
  );
}
