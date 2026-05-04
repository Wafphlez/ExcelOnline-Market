import { Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

type MarketLogTxtDropzoneProps = Readonly<{
  onFile: (file: File) => void
  disabled?: boolean
  /** Компактная кнопка вместо большой зоны */
  embedded?: boolean
}>

export function MarketLogTxtDropzone({
  onFile,
  disabled,
  embedded = false,
}: MarketLogTxtDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return
      const f = list[0]
      if (f && /\.txt$/i.test(f.name)) {
        onFile(f)
      }
    },
    [onFile]
  )

  if (embedded) {
    return (
      <div
        role="presentation"
        onDragEnter={() => setDrag(true)}
        onDragLeave={() => setDrag(false)}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          if (disabled) return
          handleFiles(e.dataTransfer.files)
        }}
        className={`${disabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        <label className="block shrink-0">
          <input
            ref={inputRef}
            type="file"
            accept=".txt,text/plain"
            className="sr-only"
            disabled={disabled}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-eve-accent/70 bg-eve-accent-muted px-4 py-2 text-xs font-semibold text-eve-accent transition-colors hover:border-eve-accent hover:bg-eve-highlight focus:outline-none focus:ring-2 focus:ring-eve-accent/35 disabled:opacity-50"
            title="Выбрать market export .txt"
            aria-label="Выбрать .txt"
          >
            <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Выбрать .txt</span>
          </button>
        </label>
      </div>
    )
  }

  return (
    <div
      role="presentation"
      onDragEnter={() => setDrag(true)}
      onDragLeave={() => setDrag(false)}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        if (disabled) return
        handleFiles(e.dataTransfer.files)
      }}
      className={`glass-panel rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${
        drag
          ? 'border-eve-accent/85 bg-eve-highlight glow-kpi'
          : 'border-eve-border/85 bg-eve-surface/45'
      } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      <Upload
        className="mx-auto mb-2 h-8 w-8 text-eve-accent/80"
        aria-hidden
      />
      <p className="mb-3 text-sm font-semibold text-eve-bright/95">
        Перетащите сюда .txt market export
      </p>
      <label className="inline-block">
        <input
          ref={inputRef}
          type="file"
          accept=".txt,text/plain"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-eve-accent/85 bg-eve-accent px-4 py-2 text-sm font-bold uppercase tracking-wider text-eve-bg shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] hover:bg-eve-accent-hover focus:outline-none focus:ring-2 focus:ring-eve-accent/50 focus:ring-offset-2 focus:ring-offset-eve-bg disabled:opacity-50"
        >
          Выбрать .txt
        </button>
      </label>
    </div>
  )
}
