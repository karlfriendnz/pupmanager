import { HelpCenter } from './help-center'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Help center' }

export default function TrainerHelpPage() {
  return <HelpCenter />
}
