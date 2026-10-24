const ALL_LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];

export default function AlphabetBar({ availableLetters = [], selected, onSelect, className = "" }) {
  const availableSet = new Set(availableLetters);

  return (
    <div
      role="toolbar"
      aria-label="Alphabetical filter"
      className={`no-scrollbar flex items-center gap-1 overflow-x-auto touch-pan-x py-1.5 ${className}`}
    >
      {ALL_LETTERS.map((letter) => {
        const isAvailable = availableSet.has(letter);
        const isSelected = selected === letter;

        return (
          <button
            key={letter}
            type="button"
            disabled={!isAvailable}
            onClick={() => onSelect(isSelected ? null : letter)}
            aria-pressed={isSelected}
            aria-label={`Filter by ${letter}`}
            className={`min-w-8 h-8 shrink-0 rounded-full px-2 text-small font-medium transition-colors ${
              isSelected
                ? "bg-accent text-accent-ink font-semibold shadow-sm"
                : isAvailable
                ? "interactive text-mute hover:text-ink hover:bg-white/10 active:bg-white/15"
                : "opacity-25 pointer-events-none text-mute"
            }`}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
}
