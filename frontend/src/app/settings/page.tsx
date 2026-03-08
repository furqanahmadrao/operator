"use client";

import { useRef, useState } from "react";
import { Camera, Settings } from "lucide-react";
import { PageShell } from "@/components/shell/page-shell";

// ── Sidebar nav ──────────────────────────────────────────────────────────────

type Section = { id: string; label: string };
const SECTIONS: Section[] = [
  { id: "profile", label: "Profile" },
  { id: "personalization", label: "Personalization" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns initials from a full name string */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("");
}

// ── Profile tab ───────────────────────────────────────────────────────────────

function ProfileTab() {
  const [name, setName] = useState("Furqan Ahmed");
  const [displayName, setDisplayName] = useState("Furqan");
  const [profession, setProfession] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setAvatarUrl(url);
  };

  const handleSave = () => {
    // Persist locally for now; backend hook goes here later
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  const avatarInitials = initials(name) || "FA";

  return (
    <div className="px-8 py-10 max-w-[680px]">

      {/* ── Avatar ──────────────────────────────────────────────────────── */}
      <div className="mb-10 flex items-start gap-6">
        <div className="relative shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name}
              className="h-20 w-20 object-cover border border-border"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center bg-text-1 text-[22px] font-bold tracking-tight text-bg">
              {avatarInitials}
            </div>
          )}
          {/* Camera overlay button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-150 hover:bg-black/30 hover:opacity-100 focus-visible:outline-none"
            aria-label="Change profile picture"
          >
            <Camera size={18} className="text-white" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
            aria-hidden
          />
        </div>

        <div className="flex-1 pt-1">
          <p
            className="text-[15px] font-semibold text-text-1"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {name || "Your Name"}
          </p>
          <p className="mt-0.5 text-[13px] text-text-3">
            {displayName ? `"${displayName}"` : ""}
            {displayName && profession ? " · " : ""}
            {profession || ""}
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 text-[12px] font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none"
          >
            Change photo
          </button>
        </div>
      </div>

      {/* ── Form fields ────────────────────────────────────────────────── */}
      <div className="space-y-6">

        {/* Full name */}
        <FieldRow
          label="Full name"
          hint="Your real name, shown in exports and documents."
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Furqan Ahmed"
            className="settings-input"
            autoComplete="name"
          />
        </FieldRow>

        {/* Display name */}
        <FieldRow
          label="What should we call you?"
          hint="A short name the Operator will use when addressing you."
        >
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Furqan"
            className="settings-input"
            autoComplete="nickname"
          />
        </FieldRow>

        {/* Profession */}
        <FieldRow
          label="Profession"
          hint="Your role or occupation — helps the Operator tailor responses."
        >
          <input
            type="text"
            value={profession}
            onChange={(e) => setProfession(e.target.value)}
            placeholder="e.g. Product Designer, Engineer, Researcher…"
            className="settings-input"
            autoComplete="organization-title"
          />
        </FieldRow>

        {/* Bio */}
        <FieldRow
          label="Bio"
          hint="A few sentences about yourself. The Operator uses this as context."
        >
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell the Operator a bit about who you are and what you work on…"
            rows={4}
            className="settings-input resize-none"
          />
        </FieldRow>

        {/* Divider */}
        <div className="border-t border-border" />

        {/* Save */}
        <div className="flex items-center gap-3">
          <button type="button" onClick={handleSave} className="btn-primary px-6 py-2 text-[13px]">
            {saved ? "Saved!" : "Save changes"}
          </button>
          {saved && (
            <span className="text-[12px] text-success">Profile updated.</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Personalization tab ──────────────────────────────────────────────────────

type PillOption = { value: string; label: string };

function PillSelector({
  options,
  value,
  onChange,
}: {
  options: PillOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none ${
            value === opt.value
              ? "border border-accent bg-accent text-white"
              : "border border-border bg-surface-1 text-text-2 hover:border-text-2 hover:text-text-1"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ToolToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border last:border-0">
      <div className="flex-1">
        <p className="text-[13px] font-medium text-text-1">{label}</p>
        <p className="mt-0.5 text-[12px] text-text-3 leading-relaxed">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-[22px] w-10 shrink-0 overflow-hidden transition-colors focus-visible:outline-none ${
          checked ? "bg-accent" : "bg-[#C8C8C8]"
        }`}
      >
        <span
          className="absolute inset-y-[3px] w-4 bg-white transition-all duration-200"
          style={{ left: checked ? "20px" : "3px" }}
        />
      </button>
    </div>
  );
}

function PersonalizationTab() {
  const [agentName, setAgentName] = useState("Operator");
  const [responseStyle, setResponseStyle] = useState("balanced");
  const [tone, setTone] = useState("professional");
  const [thinkEnabled, setThinkEnabled] = useState(true);
  const [webEnabled, setWebEnabled] = useState(true);
  const [researchEnabled, setResearchEnabled] = useState(false);
  const [aboutYou, setAboutYou] = useState("");
  const [agentBehavior, setAgentBehavior] = useState("");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  return (
    <div className="px-8 py-10 max-w-[680px]">

      {/* ── Agent identity ──────────────────────────────────────────────── */}
      <div className="mb-10">
        <h2
          className="mb-6 text-[13px] font-bold uppercase tracking-widest text-text-3"
        >
          Agent Identity
        </h2>
        <div className="space-y-6">
          <FieldRow
            label="Agent name"
            hint="What the agent calls itself in conversations and UI labels."
          >
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="e.g. Operator, Atlas, Nova…"
              className="settings-input"
            />
          </FieldRow>
        </div>
      </div>

      {/* ── Response style ───────────────────────────────────────────────── */}
      <div className="mb-10">
        <h2 className="mb-6 text-[13px] font-bold uppercase tracking-widest text-text-3">
          Response Style
        </h2>
        <div className="space-y-6">
          <FieldRow
            label="Length"
            hint="How long the agent's responses should be by default."
          >
            <PillSelector
              options={[
                { value: "concise", label: "Concise" },
                { value: "balanced", label: "Balanced" },
                { value: "detailed", label: "Detailed" },
              ]}
              value={responseStyle}
              onChange={setResponseStyle}
            />
          </FieldRow>

          <FieldRow
            label="Tone"
            hint="The communication style the agent defaults to."
          >
            <PillSelector
              options={[
                { value: "professional", label: "Professional" },
                { value: "casual", label: "Casual" },
                { value: "technical", label: "Technical" },
                { value: "creative", label: "Creative" },
              ]}
              value={tone}
              onChange={setTone}
            />
          </FieldRow>
        </div>
      </div>

      {/* ── Default tools ────────────────────────────────────────────────── */}
      <div className="mb-10">
        <h2 className="mb-4 text-[13px] font-bold uppercase tracking-widest text-text-3">
          Default Tools
        </h2>
        <p className="mb-4 text-[12px] text-text-3 leading-relaxed">
          Choose which capabilities are active by default in every new conversation.
        </p>
        <div>
          <ToolToggle
            label="Think"
            description="Extended reasoning before responding — better for complex problems."
            checked={thinkEnabled}
            onChange={setThinkEnabled}
          />
          <ToolToggle
            label="Web Search"
            description="Search the web in real-time to ground answers in current information."
            checked={webEnabled}
            onChange={setWebEnabled}
          />
          <ToolToggle
            label="Deep Research"
            description="Multi-step research mode — explores topics thoroughly before answering."
            checked={researchEnabled}
            onChange={setResearchEnabled}
          />
        </div>
      </div>

      {/* ── Custom instructions ──────────────────────────────────────────── */}
      <div className="mb-10">
        <h2 className="mb-4 text-[13px] font-bold uppercase tracking-widest text-text-3">
          Custom Instructions
        </h2>
        <div className="space-y-6">
          <FieldRow
            label="About you"
            hint="What should the agent always remember about you? Context, preferences, background."
          >
            <textarea
              value={aboutYou}
              onChange={(e) => setAboutYou(e.target.value)}
              placeholder="e.g. I'm a product designer at a fintech startup. I prefer concise, actionable answers without filler."
              rows={4}
              className="settings-input resize-none"
            />
            <p className="mt-1.5 text-right text-[11px] text-text-3">{aboutYou.length} / 1500</p>
          </FieldRow>

          <FieldRow
            label="Agent behaviour"
            hint="How should the agent respond? Any rules, constraints, or style guidelines."
          >
            <textarea
              value={agentBehavior}
              onChange={(e) => setAgentBehavior(e.target.value)}
              placeholder="e.g. Always provide a TL;DR at the top. When writing code, prefer TypeScript. Avoid passive voice."
              rows={4}
              className="settings-input resize-none"
            />
            <p className="mt-1.5 text-right text-[11px] text-text-3">{agentBehavior.length} / 1500</p>
          </FieldRow>
        </div>
      </div>

      {/* ── Divider + Save ──────────────────────────────────────────────── */}
      <div className="border-t border-border pt-6 flex items-center gap-3">
        <button type="button" onClick={handleSave} className="btn-primary px-6 py-2 text-[13px]">
          {saved ? "Saved!" : "Save changes"}
        </button>
        {saved && (
          <span className="text-[12px] text-success">Preferences saved.</span>
        )}
      </div>

    </div>
  );
}

// ── Field row ─────────────────────────────────────────────────────────────────

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_2fr] items-start gap-6">
      <div className="pt-2.5">
        <label className="block text-[13px] font-medium text-text-1">{label}</label>
        {hint && (
          <p className="mt-1 text-[12px] leading-relaxed text-text-3">{hint}</p>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("profile");

  return (
    <PageShell>
      <div className="flex min-h-full flex-col bg-bg font-sans text-text-1">

        {/* ── Top bar ────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center border-b border-border bg-bg px-5">
          <Settings size={14} className="mr-2 shrink-0 text-text-3" />
          <h1
            className="text-[13px] font-semibold text-text-1"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Settings
          </h1>
        </header>

        {/* ── Body: left sidebar + content ───────────────────────────────── */}
        <div className="flex flex-1">

          {/* Left nav sidebar */}
          <aside className="hidden w-44 shrink-0 border-r border-border bg-bg py-6 md:block">
            <p className="mb-2 px-5 text-[10px] font-semibold uppercase tracking-widest text-text-3">
              Settings
            </p>
            <nav className="flex flex-col">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveSection(s.id)}
                  className={`relative px-5 py-2 text-left text-[13px] transition-colors hover:text-text-1 focus-visible:outline-none ${
                    activeSection === s.id
                      ? "font-semibold text-text-1"
                      : "text-text-3"
                  }`}
                >
                  {activeSection === s.id && (
                    <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
                  )}
                  {s.label}
                </button>
              ))}
            </nav>
          </aside>

          {/* Main content */}
          <main className="flex-1 overflow-y-auto">
            {activeSection === "profile" && <ProfileTab />}
            {activeSection === "personalization" && <PersonalizationTab />}
          </main>

        </div>

      </div>
    </PageShell>
  );
}
