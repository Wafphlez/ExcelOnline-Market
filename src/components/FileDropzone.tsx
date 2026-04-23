import { Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

type FileDropzoneProps = {
  onFile: (file: File) => void
  disabled?: boolean
}

export function FileDropzone({ onFile, disabled }: FileDropzoneProps) {
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
      className={`rounded border-2 border-dashed px-6 py-10 text-center transition-colors ${
        drag
          ? 'border-eve-accent bg-eve-accent-muted'
          : 'border-eve-border bg-eve-bg/50'
      } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      <Upload
        className="mx-auto mb-3 h-10 w-10 text-eve-muted"
        aria-hidden
      />
      <p className="mb-2 text-sm text-eve-text">
        Перетащите сюда файл .xlsx или нажмите кнопку
      </p>
      <p className="mb-4 text-xs text-eve-muted">
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
          className="rounded border border-eve-accent bg-eve-accent px-4 py-2 text-sm font-medium text-eve-bg hover:bg-eve-accent-hover focus:outline-none focus:ring-2 focus:ring-eve-accent focus:ring-offset-2 focus:ring-offset-eve-bg disabled:opacity-50"
        >
          Выбрать .xlsx
        </button>
      </label>
    </div>
  )
}
