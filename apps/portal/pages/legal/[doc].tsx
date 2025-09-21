import { GetServerSideProps } from 'next';
import Head from 'next/head';
import fs from 'fs/promises';
import path from 'path';

async function readLegalDocument(slug: string) {
  const candidates = [
    path.resolve(process.cwd(), 'legal', `${slug}.md`),
    path.resolve(process.cwd(), '..', 'legal', `${slug}.md`),
    path.resolve(process.cwd(), '..', '..', 'legal', `${slug}.md`),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }
  throw new Error('not_found');
}
import React from 'react';

interface Props {
  doc: string;
  name: string;
  content: string;
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const doc = Array.isArray(ctx.params?.doc) ? ctx.params?.doc[0] : ctx.params?.doc ?? 'terms';
  try {
    const content = await readLegalDocument(doc);
    return {
      props: {
        doc,
        name:
          doc === 'terms'
            ? 'Terms of Service'
            : doc === 'privacy'
            ? 'Privacy Policy'
            : doc === 'risk'
            ? 'Risk Disclosure'
            : doc,
        content,
      },
    };
  } catch (err) {
    return {
      notFound: true,
    };
  }
};

export default function LegalDocument({ doc, name, content }: Props) {
  return (
    <>
      <Head>
        <title>{name}</title>
      </Head>
      <main style={{ maxWidth: 800, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
        <h1>{name}</h1>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f1f5f9', padding: '1rem', borderRadius: 8 }}>{content}</pre>
      </main>
    </>
  );
}
