import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const [api, page, board, memberPage, insights, kpis, css, tokens, migration, seriesMigration, headScope] = await Promise.all([
  read('src/features/ledger/api.ts'),
  read('src/features/ledger/LedgerPage.tsx'),
  read('src/features/ledger/LedgerBoard.tsx'),
  read('src/features/ledger/MemberLedgerPage.tsx'),
  read('src/features/ledger/LedgerInsights.tsx'),
  read('src/features/ledger/LedgerKpis.tsx'),
  read('src/features/ledger/ledger.css'),
  read('src/styles/tokens.css'),
  read('../backend/supabase/migrations/20261124050000_global_ledger.sql'),
  read('../backend/supabase/migrations/20261124060000_ledger_series.sql'),
  read('../backend/supabase/migrations/20261124070000_ledger_head_scope.sql'),
]);

test('the ledger RPCs are global: no team id is sent from the frontend anymore', () => {
  assert.match(api, /'admin_ledger_overview',\s*\{ p_unit: unit \}/);
  assert.match(api, /'member_ledger',\s*\{\}/);
  assert.match(api, /'ledger_series',\s*\{ p_unit: unit \}/);
  assert.doesNotMatch(api, /p_team_id/);
  assert.doesNotMatch(api, /teamId/);
  for (const file of readdirSync(resolve(root, 'src/features/ledger'))) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    assert.doesNotMatch(read(`src/features/ledger/${file}`), /p_team_id|teamId/, `${file} still passes a team id`);
  }
});

test('the admin ledger page drops the page header and the per-team tabs', () => {
  assert.doesNotMatch(page, /PageHeader/);
  assert.doesNotMatch(page, /ldg-team-tab/);
  assert.doesNotMatch(page, /useAdminAccess[\s\S]*teams\[0\]/);
  assert.match(page, /<LedgerBoard members=\{memberOptions\} \/>/);
  assert.doesNotMatch(board, /PageHeader/);
});

test('the ledger board filters by member unit (team / HR / PR / co-leader / owner)', () => {
  assert.match(board, /ldg-units/);
  assert.match(board, /ldg-unit/);
  assert.match(board, /payload\?\.units/);
  assert.match(board, /setUnit\(unit === item\.unit \? null : item\.unit\)/);
  assert.match(board, /summarizeFiltered/);
  assert.match(board, /row\.unit/);
  assert.match(board, /entry\.member_unit/);
});

test('the ledger numbers stay plain numbers with a home-page style sparkline', () => {
  assert.match(kpis, /from '\.\.\/dashboard\/DashboardMetrics'/);
  assert.match(kpis, /<Sparkline values=\{tile\.series\} tone=\{tile\.tone\} \/>/);
  assert.match(kpis, /AnimatedNumber/);
  assert.match(kpis, /plainNumber/);
  assert.match(board, /<LedgerKpiGrid/);
  assert.match(board, /<LedgerStatStrip/);
  assert.match(css, /\.ldg-kpi \{/);
  assert.match(css, /\.ldg-kpi \.kpi-spark \{/);
  assert.match(css, /\.ldg-strip \{/);
});

test('the monthly / quarterly / yearly range tabs are gone from the ledger chart', () => {
  assert.doesNotMatch(insights, /RANGES|RangeKey|ldg-range/);
  assert.doesNotMatch(insights, /شهري|ربع سنوي|سنوي/);
  assert.doesNotMatch(css, /\.ldg-range/);
  assert.match(insights, /last 6 months/);
  assert.match(insights, /series: LedgerSeriesPoint\[\]/);
  assert.match(seriesMigration, /generate_series\(5, 0, -1\)/);
  assert.match(seriesMigration, /public\.ledger_series/);
});

test('the member ledger view shows the whole team ledger but never who paid', () => {
  assert.doesNotMatch(memberPage, /PageHeader/);
  assert.match(memberPage, /payload\.unit/);
  assert.match(memberPage, /summary\.collected/);
  assert.match(memberPage, /summary\.expenses/);
  assert.match(memberPage, /expenses = payload\?\.expenses/);
  assert.match(memberPage, /<PayModal/);
  assert.doesNotMatch(memberPage, /ldg-team-tab|payload\.teams/);
  assert.doesNotMatch(memberPage, /members\b.*table|ldg-table/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.member_ledger\(\)/);
  assert.match(migration, /'unit', public\.member_unit\(v_member_id\)/);
  const memberBody = migration.slice(migration.indexOf('FUNCTION public.member_ledger()'), migration.indexOf('FUNCTION public.member_ledger_declare_payment'));
  assert.doesNotMatch(memberBody, /'members'/);
});

test('the global ledger schema is one ledger: nullable team id, unit helper and head scope', () => {
  assert.match(migration, /ALTER TABLE public\.team_ledger_entries ALTER COLUMN team_id DROP NOT NULL/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.member_unit\(p_member_id BIGINT\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.ledger_receivers\(p_member_id BIGINT DEFAULT NULL\)/);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.member_ledger\(UUID\)/);
  assert.match(headScope, /FROM public\.team_admin_assignments AS a/);
  assert.match(headScope, /DUPLICATE_DUE/);
});

test('green is retired from the design system and the ledger follows the dashboard tokens', () => {
  assert.doesNotMatch(tokens, /--emerald/);
  assert.doesNotMatch(tokens, /#10B981/i);
  assert.match(tokens, /--chart-accent: #5B5BF7;/);
  assert.match(tokens, /--success: #22B8E6;/);
  assert.doesNotMatch(css, /--chart-lime|--emerald|lime/i);
  for (const file of readdirSync(resolve(root, 'src/features/ledger'))) {
    if (!/\.(ts|tsx|css)$/.test(file)) continue;
    assert.doesNotMatch(read(`src/features/ledger/${file}`), /\bgreen\b|emerald|lime/i, `${file} still mentions green`);
  }
});
