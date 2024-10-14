import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetUno,
  presetWebFonts,
} from 'unocss'

export default defineConfig({
  shortcuts: [
    ['btn', 'px-4 py-1 rounded inline-block bg-blue-400 text-white cursor-pointer hover:bg-blue-500 disabled:cursor-default disabled:bg-blue-200 disabled:opacity-50'],
    ['icon-btn', 'text-[0.9em] inline-block cursor-pointer select-none opacity-75 transition duration-200 ease-in-out hover:opacity-100 hover:text-blue-400 !outline-none disabled:text-blue-200'],
  ],

  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      warn: true,
    }),
    presetWebFonts({
      fonts: {
        sans: ['Segoe UI', 'DM Sans'], // Добавляем Segoe UI в семейство sans
        serif: 'DM Serif Display',
        mono: 'DM Mono',
      },
    }),
  ],
})
