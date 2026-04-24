import { Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

type FileDropzoneProps = {
  onFile: (file: File) => void
  disabled?: boolean
  /**
   * Вложен в общую карточку: меньше отступы, спокойнее граница.
   * @default false
   */
  embedded?: boolean
}

export function FileDropzone({ onFile, disabled, embedded = false }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return
      const f = list[0]
      if (f && /\.(xlsx|xls)$/i.test(f.name)) {
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
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={disabled}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center justify-center gap-1.5 rounded border border-eve-accent/70 bg-eve-accent-muted px-4 py-2 text-xs font-semibold text-eve-accent transition-colors hover:border-eve-accent hover:bg-eve-highlight focus:outline-none focus:ring-2 focus:ring-eve-accent/35 disabled:opacity-50"
            title="Импорт .xlsx/.xls"
            aria-label="Импорт .xlsx/.xls"
          >
            <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Импорт</span>
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
      className={`rounded border-2 border-dashed px-6 py-10 text-center shadow-eve-inset transition-colors ${
        drag
          ? 'border-eve-accent/80 bg-eve-highlight'
          : 'border-eve-border/90 bg-eve-bg/40'
      } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      <Upload
        className="mx-auto mb-3 h-10 w-10 text-eve-gold/70"
        aria-hidden
      />
      <p className="mb-2 text-sm font-semibold text-eve-bright/95">
        Перетащите сюда файл .xlsx или нажмите кнопку
      </p>
      <p className="mb-4 text-xs text-eve-muted/90">
        Данные обрабатываются только в браузере, на сервер не отправляются.
      </p>
      <label className="inline-block">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="rounded border border-eve-gold/90 bg-eve-accent px-4 py-2 text-sm font-bold uppercase tracking-wider text-eve-bg shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] hover:bg-eve-accent-hover focus:outline-none focus:ring-2 focus:ring-eve-accent/50 focus:ring-offset-2 focus:ring-offset-eve-bg disabled:opacity-50"
        >
          Выбрать .xlsx
        </button>
      </label>
    </div>
  )
}
