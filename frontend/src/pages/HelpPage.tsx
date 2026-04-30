import { AlertTriangle, BookOpen, Gauge, Info, Search, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { helpSections, type HelpSection, type HelpTopic } from "../helpContent";

export function HelpPage() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSections = useMemo(() => filterSections(helpSections, normalizedQuery), [normalizedQuery]);
  const topicCount = helpSections.reduce((count, section) => count + section.topics.length, 0);
  const settingCount = helpSections.reduce(
    (count, section) => count + section.topics.reduce((topicCount, topic) => topicCount + (topic.settings?.length ?? 0), 0),
    0,
  );

  return (
    <div className="page help-page">
      <PageHeader
        title="Help"
        description="A practical guide to operating Llama-Swap Manager on your LAN rig, from imports to GPU placement and config apply."
      />

      <section className="help-hero">
        <div>
          <span className="help-kicker">Rig operations manual</span>
          <h2>Use the app without guessing what each control changes.</h2>
          <p>
            This help is written for both first-pass setup and power-user tuning. It explains what each app area does,
            what the settings affect, and where a change shows up in generated llama-swap config.
          </p>
        </div>
        <div className="help-hero-metrics" aria-label="Help coverage">
          <div>
            <BookOpen size={18} aria-hidden="true" />
            <strong>{topicCount}</strong>
            <span>topics</span>
          </div>
          <div>
            <Settings2 size={18} aria-hidden="true" />
            <strong>{settingCount}</strong>
            <span>settings</span>
          </div>
          <div>
            <Gauge size={18} aria-hidden="true" />
            <strong>current</strong>
            <span>app scope</span>
          </div>
        </div>
      </section>

      <section className="help-search-panel">
        <label className="help-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Search help</span>
          <input
            type="search"
            aria-label="Search help"
            value={query}
            placeholder="Search settings, flags, pages, GPU terms..."
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="help-source-note">
          <Info size={16} aria-hidden="true" />
          <span>Built for the current app, matrix config, and your /models Docker layout.</span>
        </div>
      </section>

      <div className="help-layout">
        <aside className="help-rail" aria-label="Help sections">
          {filteredSections.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              <span>{section.eyebrow}</span>
              {section.title}
            </a>
          ))}
        </aside>

        <div className="help-results" data-testid="help-results">
          {filteredSections.length ? (
            filteredSections.map((section) => <HelpSectionView key={section.id} section={section} />)
          ) : (
            <section className="panel empty-state">
              <Search size={18} aria-hidden="true" />
              <div>
                <strong>No help topics matched.</strong>
                <p>Try searching for a page name, llama.cpp flag, path setting, or GPU term.</p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function HelpSectionView({ section }: { section: HelpSection }) {
  return (
    <section id={section.id} className="help-section">
      <div className="help-section-header">
        <span>{section.eyebrow}</span>
        <h2>{section.title}</h2>
        <p>{section.description}</p>
      </div>
      <div className="help-topic-grid">
        {section.topics.map((topic) => (
          <article key={topic.id} id={topic.id} className="help-topic">
            <div className="help-topic-head">
              <h3>{topic.title}</h3>
              <p>{topic.summary}</p>
            </div>
            {topic.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {topic.settings?.length ? (
              <div className="help-setting-list">
                {topic.settings.map((setting) => (
                  <div key={setting.name} className="help-setting-card">
                    <h4>{setting.name}</h4>
                    <dl>
                      <dt>For</dt>
                      <dd>{setting.purpose}</dd>
                      <dt>Effect</dt>
                      <dd>{setting.effect}</dd>
                      {setting.guidance ? (
                        <>
                          <dt>Use it</dt>
                          <dd>{setting.guidance}</dd>
                        </>
                      ) : null}
                    </dl>
                  </div>
                ))}
              </div>
            ) : null}
            {topic.examples?.length ? (
              <div className="help-example">
                <strong>Examples</strong>
                {topic.examples.map((example) => (
                  <code key={example}>{example}</code>
                ))}
              </div>
            ) : null}
            {topic.warnings?.length ? (
              <div className="help-warning">
                <AlertTriangle size={16} aria-hidden="true" />
                <div>
                  {topic.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function filterSections(sections: HelpSection[], query: string): HelpSection[] {
  if (!query) return sections;
  return sections
    .map((section) => {
      const sectionMatches = searchable([section.title, section.eyebrow, section.description]).includes(query);
      const topics = section.topics.filter((topic) => sectionMatches || topicMatches(topic, query));
      return topics.length ? { ...section, topics } : null;
    })
    .filter((section): section is HelpSection => Boolean(section));
}

function topicMatches(topic: HelpTopic, query: string): boolean {
  return searchable([
    topic.title,
    topic.summary,
    ...topic.body,
    ...(topic.examples ?? []),
    ...(topic.warnings ?? []),
    ...(topic.settings ?? []).flatMap((setting) => [setting.name, setting.purpose, setting.effect, setting.guidance ?? ""]),
  ]).includes(query);
}

function searchable(values: string[]): string {
  return values.join(" ").toLowerCase();
}
