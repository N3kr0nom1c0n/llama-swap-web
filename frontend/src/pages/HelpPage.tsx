import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Cable,
  Compass,
  Cpu,
  FileCode2,
  Gauge,
  Info,
  ListChecks,
  Search,
  Settings2,
  Workflow,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PageHeader } from "../components/PageHeader";
import {
  glossaryTerms,
  impactRows,
  wikiSections,
  type GlossaryTerm,
  type ImpactRow,
  type WikiArticle,
  type WikiSection,
  type WikiSetting,
} from "../helpContent";

type WikiSearch = {
  sections: WikiSection[];
  impactRows: ImpactRow[];
  glossaryTerms: GlossaryTerm[];
};

const articleIndex = new Map(
  wikiSections.flatMap((section) => section.articles.map((article) => [article.id, article.title] as const)),
);
const glossaryIndex = new Map(glossaryTerms.map((term) => [term.term.toLowerCase(), term]));
const articleCount = wikiSections.reduce((count, section) => count + section.articles.length, 0);

export function HelpPage() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => filterWiki(normalizedQuery), [normalizedQuery]);
  const hasResults =
    filtered.sections.length > 0 || filtered.impactRows.length > 0 || filtered.glossaryTerms.length > 0;

  return (
    <div className="page help-page">
      <PageHeader
        title="Manager Wiki"
        description="A linked runbook for every page, workflow, setting, flag, and llama-swap term this app exposes."
      />

      <section className="wiki-hero">
        <div className="wiki-hero-copy">
          <span className="wiki-kicker">LAN rig wiki</span>
          <h2>Stop guessing what the control does before you move it.</h2>
          <p>
            This page is organized like an operator wiki: page guides, setting impact notes, runbooks, and glossary
            entries that link back to the article where the term matters.
          </p>
        </div>
        <div className="wiki-hero-map" aria-label="Wiki coverage">
          <Metric icon={<BookOpen size={18} aria-hidden="true" />} value={articleCount} label="articles" />
          <Metric icon={<Gauge size={18} aria-hidden="true" />} value={impactRows.length} label="impact rows" />
          <Metric icon={<Settings2 size={18} aria-hidden="true" />} value={glossaryTerms.length} label="terms" />
        </div>
      </section>

      <section className="wiki-search-panel">
        <label className="wiki-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Search wiki</span>
          <input
            type="search"
            aria-label="Search wiki"
            value={query}
            placeholder="Search pages, settings, flags, workflows, or glossary terms..."
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="wiki-search-meta">
          <Info size={16} aria-hidden="true" />
          <span>{normalizedQuery ? "Filtering articles, impact rows, and glossary." : "Current app scope, matrix config, /models Docker layout."}</span>
        </div>
      </section>

      <div className="wiki-layout">
        <aside className="wiki-rail" aria-label="Wiki navigation">
          <nav>
            <a href="#wiki-impact">
              <Gauge size={16} aria-hidden="true" />
              Settings Impact
            </a>
            {filtered.sections.map((section) => (
              <a key={section.id} href={`#${section.id}`}>
                {sectionIcon(section.id)}
                <span>
                  <small>{section.eyebrow}</small>
                  {section.title}
                </span>
              </a>
            ))}
            <a href="#wiki-glossary">
              <BookOpen size={16} aria-hidden="true" />
              Glossary
            </a>
          </nav>
        </aside>

        <div className="wiki-results" data-testid="help-results">
          {hasResults ? (
            <>
              <ImpactMatrix rows={filtered.impactRows} query={normalizedQuery} />
              {filtered.sections.map((section) => (
                <WikiSectionView key={section.id} section={section} />
              ))}
              <Glossary terms={filtered.glossaryTerms} query={normalizedQuery} />
            </>
          ) : (
            <section className="panel empty-state">
              <Search size={18} aria-hidden="true" />
              <div>
                <strong>No wiki results matched.</strong>
                <p>Try a page name, llama.cpp flag, path setting, GPU term, or failure state.</p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <div>
      {icon}
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ImpactMatrix({ rows, query }: { rows: ImpactRow[]; query: string }) {
  if (query && rows.length === 0) return null;

  return (
    <section id="wiki-impact" className="wiki-impact-section">
      <div className="wiki-section-title">
        <span className="wiki-kicker">Fast answers</span>
        <h2>Settings Impact Matrix</h2>
        <p>Use this when you know the control but need the tradeoff before changing it.</p>
      </div>
      <div className="wiki-impact-table" role="table" aria-label="Settings impact matrix">
        <div className="wiki-impact-head" role="row">
          <span role="columnheader">Setting</span>
          <span role="columnheader">If you change X</span>
          <span role="columnheader">It can net you Y</span>
          <span role="columnheader">Cost</span>
          <span role="columnheader">Where</span>
        </div>
        {rows.map((row) => (
          <a key={row.id} className="wiki-impact-row" href={`#${row.articleId}`} role="row">
            <strong role="cell">{row.setting}</strong>
            <span role="cell">{row.change}</span>
            <span role="cell">{row.canNet}</span>
            <span role="cell">{row.cost}</span>
            <span role="cell">{row.where}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function WikiSectionView({ section }: { section: WikiSection }) {
  return (
    <section id={section.id} className="wiki-section">
      <div className="wiki-section-title">
        <span className="wiki-kicker">{section.eyebrow}</span>
        <h2>{section.title}</h2>
        <p>{section.description}</p>
      </div>
      <div className="wiki-article-list">
        {section.articles.map((article) => (
          <WikiArticleView key={article.id} article={article} />
        ))}
      </div>
    </section>
  );
}

function WikiArticleView({ article }: { article: WikiArticle }) {
  return (
    <article id={article.id} className="wiki-article">
      <header className="wiki-article-head">
        <div>
          <span>{article.category}</span>
          <h3>{article.title}</h3>
          <p>{article.summary}</p>
        </div>
        <a className="wiki-anchor-link" href={`#${article.id}`} aria-label={`Link to ${article.title}`}>
          #
        </a>
      </header>

      <div className="wiki-prose">
        {article.details.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>

      {article.workflow?.length ? (
        <div className="wiki-workflow">
          <div className="wiki-block-label">
            <Workflow size={16} aria-hidden="true" />
            Workflow
          </div>
          <ol>
            {article.workflow.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {article.settings?.length ? <SettingsGrid settings={article.settings} /> : null}

      {article.examples?.length ? (
        <div className="wiki-examples">
          <div className="wiki-block-label">
            <FileCode2 size={16} aria-hidden="true" />
            Examples
          </div>
          {article.examples.map((example) => (
            <code key={example}>{example}</code>
          ))}
        </div>
      ) : null}

      {article.warnings?.length ? (
        <div className="wiki-warning">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            {article.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </div>
      ) : null}

      <footer className="wiki-article-footer">
        {article.relatedTerms?.length ? (
          <div>
            <span>Terms</span>
            <div className="wiki-chip-list">
              {article.relatedTerms.map((term) => (
                <GlossaryChip key={term} term={term} />
              ))}
            </div>
          </div>
        ) : null}
        {article.relatedArticles?.length ? (
          <div>
            <span>Related</span>
            <div className="wiki-chip-list">
              {article.relatedArticles.map((articleId) => (
                <a key={articleId} href={`#${articleId}`}>
                  {articleIndex.get(articleId) ?? articleId}
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </footer>
    </article>
  );
}

function SettingsGrid({ settings }: { settings: WikiSetting[] }) {
  return (
    <div className="wiki-settings-grid">
      {settings.map((setting) => (
        <div key={setting.name} className="wiki-setting">
          <h4>{setting.name}</h4>
          <dl>
            <dt>For</dt>
            <dd>{setting.purpose}</dd>
            <dt>If changed</dt>
            <dd>{setting.ifYouChange}</dd>
            <dt>Cost</dt>
            <dd>{setting.tradeoff}</dd>
            <dt>Where</dt>
            <dd>{setting.where}</dd>
          </dl>
        </div>
      ))}
    </div>
  );
}

function Glossary({ terms, query }: { terms: GlossaryTerm[]; query: string }) {
  if (query && terms.length === 0) return null;

  return (
    <section id="wiki-glossary" className="wiki-glossary-section">
      <div className="wiki-section-title">
        <span className="wiki-kicker">Linked definitions</span>
        <h2>Glossary</h2>
        <p>Every term links back to the article where changing that thing matters.</p>
      </div>
      <div className="wiki-glossary-grid">
        {terms.map((term) => (
          <article key={term.slug} id={`term-${term.slug}`} data-testid={`glossary-${term.slug}`} className="wiki-term">
            <div>
              <h3>{term.term}</h3>
              <p>{term.shortDefinition}</p>
            </div>
            <p>{term.details}</p>
            <a href={`#${term.articleId}`}>
              Read article
              <ArrowRight size={14} aria-hidden="true" />
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}

function GlossaryChip({ term }: { term: string }) {
  const glossaryTerm = glossaryIndex.get(term.toLowerCase());

  return <a href={glossaryTerm ? `#${glossaryTerm.articleId}` : `#term-${slugify(term)}`}>{term}</a>;
}

function filterWiki(query: string): WikiSearch {
  if (!query) {
    return {
      sections: wikiSections,
      impactRows,
      glossaryTerms,
    };
  }

  const sections = wikiSections
    .map((section) => {
      const sectionMatches = searchable([section.title, section.eyebrow, section.description]).includes(query);
      const articles = section.articles.filter((article) => sectionMatches || articleMatches(article, query));
      return articles.length ? { ...section, articles } : null;
    })
    .filter((section): section is WikiSection => Boolean(section));

  return {
    sections,
    impactRows: impactRows.filter((row) =>
      searchable([row.setting, row.change, row.canNet, row.cost, row.where, articleIndex.get(row.articleId) ?? ""]).includes(
        query,
      ),
    ),
    glossaryTerms: glossaryTerms.filter((term) =>
      searchable([
        term.term,
        term.shortDefinition,
        term.details,
        articleIndex.get(term.articleId) ?? "",
        ...(term.relatedTerms ?? []),
      ]).includes(query),
    ),
  };
}

function articleMatches(article: WikiArticle, query: string): boolean {
  return searchable([
    article.title,
    article.category,
    article.summary,
    ...article.details,
    ...(article.workflow ?? []),
    ...(article.examples ?? []),
    ...(article.warnings ?? []),
    ...(article.relatedTerms ?? []),
    ...(article.relatedArticles ?? []).map((articleId) => articleIndex.get(articleId) ?? articleId),
    ...(article.tags ?? []),
    ...(article.settings ?? []).flatMap((setting) => [
      setting.name,
      setting.purpose,
      setting.ifYouChange,
      setting.tradeoff,
      setting.where,
    ]),
  ]).includes(query);
}

function searchable(values: string[]): string {
  return values.join(" ").toLowerCase();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function sectionIcon(sectionId: string) {
  if (sectionId === "start-here") return <Compass size={16} aria-hidden="true" />;
  if (sectionId === "page-guides") return <ListChecks size={16} aria-hidden="true" />;
  if (sectionId === "settings-flags") return <Settings2 size={16} aria-hidden="true" />;
  if (sectionId === "runbooks") return <Cable size={16} aria-hidden="true" />;
  return <Cpu size={16} aria-hidden="true" />;
}
