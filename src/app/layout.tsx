import type { Metadata } from 'next'
import { Playfair_Display, IBM_Plex_Sans, IBM_Plex_Mono, Libre_Baskerville } from 'next/font/google'
import './globals.css'

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['700', '800'],
  variable: '--font-playfair',
})

const baskerville = Libre_Baskerville({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-baskerville',
})

const ibm = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm',
})

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'Portfolai — UK Property Investment Intelligence',
  description: 'Professional property investment analysis platform. Real Land Registry data, AI analytics, ROI calculators and market intelligence for UK buy-to-let investors.',
  keywords: 'property investment, buy to let, rental yield, ROI calculator, UK property, HMO, capital growth',
  openGraph: {
    title: 'Portfolai — UK Property Investment Intelligence',
    description: 'The professional property investor\'s platform. Real data, AI analytics, instant ROI.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${ibm.variable} ${mono.variable} ${baskerville.variable}`}>
      <body className="bg-[#FAF9F5] text-[#111827] font-body antialiased">
        {children}
      </body>
    </html>
  )
}
