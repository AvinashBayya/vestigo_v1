# Legacy classification (R0)

Reference data, not production code: it does not ship. Produced by
`node packages/config/scripts/legacy-classify.ts` over the read-only `legacy/` tree, as R0 of the
reclamation track (`docs/MASTER-BUILD-SEQUENCE.md`; method in `docs/vapt/VAPT-REFERENCES.md`
part 1d). It is the harvest list R1 starts from. Nothing has been ported by this pass.

Generated 2026-10-06 from 299 TypeScript files in `legacy/src` and `legacy/scripts`;
105 files in `legacy/tests` were read as importers only. `legacy/ai-service` is Python and
outside this pass.

## Bins

Each exported function, class, and object holding functions (a collector definition, say) gets
the first bin that applies, in this order:

- **UI/DEAD**: renders JSX, uses a React hook or React, touches browser state (`localStorage`,
  `sessionStorage`, `window`, `document`, `navigator`), or is imported by nothing in `legacy/`
  (tests count as importers; route files and the app entry points are loaded by the framework).
- **FABRICATION-FLAGGED**: this repository's fabrication gate fires inside it: the line patterns
  (`scripts/fabrication.ts`) or the AST rule `no-fabricated-fallback`
  (`eslint/fabrication-plugin.js`). Legacy's own disable comments are ignored: the gate here has
  no escape hatch.
- **IO-BOUND**: network, disk, database or queue, directly or by calling a function that is
  (followed across files to a fixed point). The clock, randomness and the process environment
  are binned here too: they break determinism the same way, and are ported the same way, by
  injecting them.
- **PURE**: none of the above. Deterministic. The harvest list.

**Limits of a syntactic pass.** Calls through a parameter, an object's method or a dynamic
import are not followed, so a function handed an I/O callback reads as PURE. A function that
is exported but used only inside its own file reads as dead. Classes are binned as a whole.
Treat PURE as "no I/O found", and confirm when porting: CLAUDE.md requires every port to pass
the gate and bring its tests.

## Summary

| Bin | Exports |
|---|---|
| PURE | 489 |
| FABRICATION-FLAGGED | 52 |
| IO-BOUND | 160 |
| UI/DEAD | 461 |
| **Total** | **1162** |

Not classified: 378 exported constants that hold only data (tables, defaults,
word lists, configuration). They have no behaviour to bin; R1 takes them with whatever uses them.

### By area

| Area | PURE | FABRICATION-FLAGGED | IO-BOUND | UI/DEAD |
|---|---|---|---|---|
| `src/components` | 0 | 0 | 0 | 242 |
| `src/data` | 0 | 0 | 0 | 1 |
| `src/hooks` | 0 | 0 | 0 | 1 |
| `src/i18n` | 3 | 0 | 0 | 7 |
| `src/lib` | 2 | 0 | 1 | 0 |
| `src/router` | 1 | 0 | 0 | 0 |
| `src/routes` | 12 | 5 | 6 | 0 |
| `src/start` | 0 | 0 | 1 | 0 |
| `src/types` | 14 | 0 | 0 | 0 |
| `src/utils/active-target` | 1 | 0 | 0 | 5 |
| `src/utils/ai-service-client` | 1 | 0 | 6 | 0 |
| `src/utils/analysis` | 8 | 3 | 0 | 0 |
| `src/utils/analysis-llm` | 0 | 0 | 4 | 4 |
| `src/utils/attack-surface` | 3 | 0 | 3 | 1 |
| `src/utils/audio-events` | 3 | 0 | 0 | 0 |
| `src/utils/audio-extract-client` | 3 | 0 | 0 | 1 |
| `src/utils/audio-fingerprint-store` | 2 | 0 | 1 | 1 |
| `src/utils/audio-frequency` | 13 | 2 | 0 | 2 |
| `src/utils/bookmark-store` | 7 | 0 | 0 | 2 |
| `src/utils/cases` | 42 | 4 | 3 | 37 |
| `src/utils/cib` | 10 | 1 | 2 | 0 |
| `src/utils/client-ip` | 7 | 0 | 0 | 0 |
| `src/utils/collection-policy` | 4 | 0 | 0 | 0 |
| `src/utils/collector-health` | 0 | 0 | 1 | 1 |
| `src/utils/collectors` | 24 | 0 | 26 | 15 |
| `src/utils/credential-vault` | 12 | 1 | 9 | 3 |
| `src/utils/credibility` | 7 | 0 | 2 | 8 |
| `src/utils/credibility-llm` | 1 | 0 | 1 | 1 |
| `src/utils/credibility-profiles` | 2 | 0 | 0 | 4 |
| `src/utils/cyber-intel` | 0 | 0 | 0 | 1 |
| `src/utils/demo-session` | 4 | 0 | 1 | 3 |
| `src/utils/dorks` | 3 | 1 | 0 | 0 |
| `src/utils/environmental` | 5 | 0 | 0 | 0 |
| `src/utils/environmental-sources` | 2 | 0 | 1 | 0 |
| `src/utils/evidence` | 3 | 0 | 0 | 1 |
| `src/utils/evidence-store` | 8 | 0 | 2 | 2 |
| `src/utils/file-handoff` | 2 | 0 | 0 | 0 |
| `src/utils/file-provenance` | 42 | 0 | 0 | 0 |
| `src/utils/file-provenance-client` | 5 | 0 | 1 | 8 |
| `src/utils/focal-point` | 1 | 0 | 0 | 0 |
| `src/utils/geo` | 13 | 5 | 0 | 1 |
| `src/utils/geo-sources` | 0 | 0 | 3 | 10 |
| `src/utils/geoint` | 12 | 1 | 0 | 6 |
| `src/utils/gps-interference` | 2 | 0 | 0 | 5 |
| `src/utils/gpsjam-url` | 1 | 0 | 0 | 0 |
| `src/utils/graph-build` | 6 | 2 | 0 | 0 |
| `src/utils/graph-layout` | 2 | 0 | 0 | 0 |
| `src/utils/graph-store` | 3 | 0 | 0 | 7 |
| `src/utils/graph-view` | 6 | 2 | 0 | 1 |
| `src/utils/highlight` | 0 | 0 | 0 | 2 |
| `src/utils/image-sources` | 0 | 2 | 3 | 1 |
| `src/utils/imaging` | 12 | 1 | 0 | 0 |
| `src/utils/imaging-client` | 6 | 1 | 0 | 7 |
| `src/utils/investigations-store` | 3 | 4 | 1 | 2 |
| `src/utils/leaflet-client` | 4 | 1 | 1 | 0 |
| `src/utils/live-filters` | 2 | 0 | 0 | 0 |
| `src/utils/llm` | 2 | 0 | 11 | 9 |
| `src/utils/local-id` | 0 | 0 | 1 | 0 |
| `src/utils/local-network` | 1 | 2 | 1 | 3 |
| `src/utils/maltego-export` | 2 | 0 | 0 | 0 |
| `src/utils/manual-evidence` | 4 | 0 | 0 | 0 |
| `src/utils/mediaint` | 6 | 0 | 0 | 9 |
| `src/utils/news-aggregation` | 1 | 0 | 3 | 0 |
| `src/utils/operational-error` | 7 | 2 | 0 | 0 |
| `src/utils/operator-auth` | 3 | 0 | 3 | 0 |
| `src/utils/osint` | 27 | 2 | 15 | 7 |
| `src/utils/osint-summary` | 3 | 0 | 0 | 0 |
| `src/utils/pdf-revocation` | 1 | 0 | 0 | 0 |
| `src/utils/pdf-revocation-client` | 0 | 0 | 1 | 0 |
| `src/utils/pdf-revocation-server` | 0 | 0 | 2 | 0 |
| `src/utils/radiation` | 0 | 0 | 0 | 4 |
| `src/utils/rate-limit` | 8 | 0 | 3 | 1 |
| `src/utils/rate-limit-runtime` | 2 | 0 | 1 | 3 |
| `src/utils/rate-limit-tiers` | 2 | 0 | 0 | 0 |
| `src/utils/recon-sources` | 2 | 0 | 2 | 1 |
| `src/utils/report-pdf` | 0 | 1 | 0 | 0 |
| `src/utils/reports` | 11 | 1 | 1 | 2 |
| `src/utils/rss-source` | 4 | 0 | 0 | 0 |
| `src/utils/scan-authorization` | 11 | 0 | 0 | 1 |
| `src/utils/search` | 8 | 0 | 0 | 1 |
| `src/utils/security-headers` | 2 | 0 | 3 | 0 |
| `src/utils/social` | 15 | 2 | 15 | 10 |
| `src/utils/social-attach` | 0 | 0 | 1 | 0 |
| `src/utils/social-credibility` | 4 | 1 | 1 | 1 |
| `src/utils/social-velocity` | 0 | 1 | 0 | 0 |
| `src/utils/source-cache` | 0 | 0 | 1 | 0 |
| `src/utils/supply-demand-sources` | 0 | 0 | 1 | 1 |
| `src/utils/telegram-intel` | 0 | 0 | 0 | 2 |
| `src/utils/theme` | 0 | 0 | 0 | 3 |
| `src/utils/threat-classifier` | 1 | 0 | 0 | 0 |
| `src/utils/timeline` | 3 | 0 | 0 | 0 |
| `src/utils/timeline-store` | 3 | 0 | 0 | 7 |
| `src/utils/transcription` | 2 | 0 | 4 | 0 |
| `src/utils/validation` | 10 | 1 | 3 | 1 |
| `src/utils/vehicle-osint` | 2 | 1 | 1 | 0 |
| `src/utils/watchlist-store` | 3 | 1 | 1 | 2 |
| `src/utils/youtube-collector` | 10 | 1 | 6 | 0 |

## Every export

| Path | Export | Bin | Reason |
|---|---|---|---|
| `src/components/ai-analysis-panel.tsx:102` | `AiAnalysisPanel` | UI/DEAD | uses a React hook (useRef) |
| `src/components/app-shell.tsx:848` | `AppShell` | UI/DEAD | renders JSX |
| `src/components/app-shell.tsx:860` | `PageHeader` | UI/DEAD | renders JSX |
| `src/components/app-shell.tsx:887` | `StatusDot` | UI/DEAD | renders JSX |
| `src/components/app-shell.tsx:907` | `toneBadge` | UI/DEAD | no legacy module or test imports it |
| `src/components/app-shell.tsx:958` | `Tone` | UI/DEAD | renders JSX |
| `src/components/article-ai.tsx:42` | `ArticleAiPanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/audio-events-panel.tsx:73` | `AudioEventsPanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/audio-spectrum-panel.tsx:430` | `AudioSpectrumPanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/case-context-detail.tsx:102` | `CaseContextDetail` | UI/DEAD | renders JSX |
| `src/components/case-contradictions-panel.tsx:267` | `CaseContradictionsPanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/case-correlations-panel.tsx:137` | `CaseCorrelationsPanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/case-entities-panel.tsx:60` | `CaseEntitiesPanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/case-intelligence-breakdown.tsx:163` | `CaseIntelligenceBreakdownPanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/case-mediaint-panel.tsx:167` | `CaseMediaIntPanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/case-runs-panel.tsx:97` | `CaseRunsPanel` | UI/DEAD | uses a React hook (useNavigate) |
| `src/components/case-scope-panel.tsx:94` | `CaseScopePanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/case-snapshot-selector.tsx:38` | `CaseSnapshotSelector` | UI/DEAD | renders JSX |
| `src/components/case-summary-panel.tsx:122` | `CaseSummaryPanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/cluster-panel.tsx:32` | `ClusterPanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/credential-notice.tsx:24` | `CredentialNotice` | UI/DEAD | renders JSX |
| `src/components/demo-session.tsx:35` | `DemoSessionProvider` | UI/DEAD | uses a React hook (useState) |
| `src/components/demo-session.tsx:74` | `useDemoSession` | UI/DEAD | uses a React hook (useContext) |
| `src/components/environmental-context.tsx:10` | `SourceSnapshotStatus` | UI/DEAD | renders JSX |
| `src/components/environmental-context.tsx:30` | `SpaceWeatherReadings` | UI/DEAD | renders JSX |
| `src/components/environmental-context.tsx:119` | `EnvironmentalContextPanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/exif-map.tsx:37` | `ExifMap` | UI/DEAD | uses a React hook (useRef) |
| `src/components/file-provenance-report.tsx:50` | `FileProvenanceReportList` | UI/DEAD | renders JSX |
| `src/components/geoint-panel.tsx:60` | `GeoIntPanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/language-switcher.tsx:25` | `LanguageSwitcher` | UI/DEAD | uses a React hook (useI18n) |
| `src/components/llm-quota.tsx:30` | `LlmQuotaCard` | UI/DEAD | uses a React hook (useState) |
| `src/components/manual-capture-panel.tsx:45` | `ManualCapturePanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/markdown-report.tsx:17` | `MarkdownReport` | UI/DEAD | renders JSX |
| `src/components/not-implemented.tsx:33` | `NotImplementedPanel` | UI/DEAD | uses a React hook (useState) |
| `src/components/pin-button.tsx:24` | `PinButton` | UI/DEAD | uses a React hook (useState) |
| `src/components/report-blocks.tsx:15` | `ReportBlock` | UI/DEAD | renders JSX |
| `src/components/report-blocks.tsx:46` | `ReportSectionHeader` | UI/DEAD | renders JSX |
| `src/components/report-blocks.tsx:61` | `ReportMetaGrid` | UI/DEAD | renders JSX |
| `src/components/report-blocks.tsx:75` | `ThreatLevelBadge` | UI/DEAD | renders JSX |
| `src/components/sample-data-banner.tsx:14` | `SampleDataBanner` | UI/DEAD | renders JSX |
| `src/components/sidebar-nav.tsx:44` | `SidebarNav` | UI/DEAD | uses a React hook (useT) |
| `src/components/snapshot-provenance.tsx:35` | `SnapshotProvenanceLine` | UI/DEAD | renders JSX |
| `src/components/theme-toggle.tsx:30` | `ThemeToggle` | UI/DEAD | uses a React hook (useState) |
| `src/components/timeline.tsx:11` | `Timeline` | UI/DEAD | renders JSX |
| `src/components/ui/accordion.tsx:9` | `AccordionItem` | UI/DEAD | renders JSX |
| `src/components/ui/accordion.tsx:17` | `AccordionTrigger` | UI/DEAD | renders JSX |
| `src/components/ui/accordion.tsx:37` | `AccordionContent` | UI/DEAD | renders JSX |
| `src/components/ui/alert-dialog.tsx:13` | `AlertDialogOverlay` | UI/DEAD | renders JSX |
| `src/components/ui/alert-dialog.tsx:28` | `AlertDialogContent` | UI/DEAD | renders JSX |
| `src/components/ui/alert-dialog.tsx:46` | `AlertDialogHeader` | UI/DEAD | renders JSX |
| `src/components/ui/alert-dialog.tsx:51` | `AlertDialogFooter` | UI/DEAD | renders JSX |
| `src/components/ui/alert-dialog.tsx:59` | `AlertDialogTitle` | UI/DEAD | renders JSX |
| `src/components/ui/alert-dialog.tsx:71` | `AlertDialogDescription` | UI/DEAD | renders JSX |
| `src/components/ui/alert-dialog.tsx:83` | `AlertDialogAction` | UI/DEAD | renders JSX |
| `src/components/ui/alert-dialog.tsx:91` | `AlertDialogCancel` | UI/DEAD | renders JSX |
| `src/components/ui/alert.tsx:22` | `Alert` | UI/DEAD | renders JSX |
| `src/components/ui/alert.tsx:30` | `AlertTitle` | UI/DEAD | renders JSX |
| `src/components/ui/alert.tsx:41` | `AlertDescription` | UI/DEAD | renders JSX |
| `src/components/ui/avatar.tsx:8` | `Avatar` | UI/DEAD | renders JSX |
| `src/components/ui/avatar.tsx:20` | `AvatarImage` | UI/DEAD | renders JSX |
| `src/components/ui/avatar.tsx:32` | `AvatarFallback` | UI/DEAD | renders JSX |
| `src/components/ui/badge.tsx:28` | `Badge` | UI/DEAD | renders JSX |
| `src/components/ui/breadcrumb.tsx:7` | `Breadcrumb` | UI/DEAD | renders JSX |
| `src/components/ui/breadcrumb.tsx:15` | `BreadcrumbList` | UI/DEAD | renders JSX |
| `src/components/ui/breadcrumb.tsx:29` | `BreadcrumbItem` | UI/DEAD | renders JSX |
| `src/components/ui/breadcrumb.tsx:36` | `BreadcrumbLink` | UI/DEAD | renders JSX |
| `src/components/ui/breadcrumb.tsx:54` | `BreadcrumbPage` | UI/DEAD | renders JSX |
| `src/components/ui/breadcrumb.tsx:68` | `BreadcrumbSeparator` | UI/DEAD | renders JSX |
| `src/components/ui/breadcrumb.tsx:80` | `BreadcrumbEllipsis` | UI/DEAD | renders JSX |
| `src/components/ui/button.tsx:39` | `Button` | UI/DEAD | renders JSX |
| `src/components/ui/calendar.tsx:10` | `Calendar` | UI/DEAD | renders JSX |
| `src/components/ui/calendar.tsx:139` | `CalendarDayButton` | UI/DEAD | renders JSX |
| `src/components/ui/card.tsx:5` | `Card` | UI/DEAD | renders JSX |
| `src/components/ui/card.tsx:16` | `CardHeader` | UI/DEAD | renders JSX |
| `src/components/ui/card.tsx:23` | `CardTitle` | UI/DEAD | renders JSX |
| `src/components/ui/card.tsx:34` | `CardDescription` | UI/DEAD | renders JSX |
| `src/components/ui/card.tsx:41` | `CardContent` | UI/DEAD | renders JSX |
| `src/components/ui/card.tsx:48` | `CardFooter` | UI/DEAD | renders JSX |
| `src/components/ui/carousel.tsx:41` | `Carousel` | UI/DEAD | uses a React hook (useEmblaCarousel) |
| `src/components/ui/carousel.tsx:135` | `CarouselContent` | UI/DEAD | uses a React hook (useCarousel) |
| `src/components/ui/carousel.tsx:156` | `CarouselItem` | UI/DEAD | uses a React hook (useCarousel) |
| `src/components/ui/carousel.tsx:177` | `CarouselPrevious` | UI/DEAD | uses a React hook (useCarousel) |
| `src/components/ui/carousel.tsx:205` | `CarouselNext` | UI/DEAD | uses a React hook (useCarousel) |
| `src/components/ui/chart.tsx:35` | `ChartContainer` | UI/DEAD | renders JSX |
| `src/components/ui/chart.tsx:64` | `ChartStyle` | UI/DEAD | renders JSX |
| `src/components/ui/chart.tsx:95` | `ChartTooltipContent` | UI/DEAD | uses a React hook (useChart) |
| `src/components/ui/chart.tsx:243` | `ChartLegendContent` | UI/DEAD | uses a React hook (useChart) |
| `src/components/ui/checkbox.tsx:7` | `Checkbox` | UI/DEAD | renders JSX |
| `src/components/ui/command.tsx:11` | `Command` | UI/DEAD | renders JSX |
| `src/components/ui/command.tsx:26` | `CommandDialog` | UI/DEAD | renders JSX |
| `src/components/ui/command.tsx:38` | `CommandInput` | UI/DEAD | renders JSX |
| `src/components/ui/command.tsx:57` | `CommandList` | UI/DEAD | renders JSX |
| `src/components/ui/command.tsx:70` | `CommandEmpty` | UI/DEAD | renders JSX |
| `src/components/ui/command.tsx:79` | `CommandGroup` | UI/DEAD | renders JSX |
| `src/components/ui/command.tsx:95` | `CommandSeparator` | UI/DEAD | renders JSX |
| `src/components/ui/command.tsx:107` | `CommandItem` | UI/DEAD | renders JSX |
| `src/components/ui/command.tsx:123` | `CommandShortcut` | UI/DEAD | renders JSX |
| `src/components/ui/context-menu.tsx:19` | `ContextMenuSubTrigger` | UI/DEAD | renders JSX |
| `src/components/ui/context-menu.tsx:40` | `ContextMenuSubContent` | UI/DEAD | renders JSX |
| `src/components/ui/context-menu.tsx:55` | `ContextMenuContent` | UI/DEAD | renders JSX |
| `src/components/ui/context-menu.tsx:72` | `ContextMenuItem` | UI/DEAD | renders JSX |
| `src/components/ui/context-menu.tsx:90` | `ContextMenuCheckboxItem` | UI/DEAD | renders JSX |
| `src/components/ui/context-menu.tsx:113` | `ContextMenuRadioItem` | UI/DEAD | renders JSX |
| `src/components/ui/context-menu.tsx:135` | `ContextMenuLabel` | UI/DEAD | renders JSX |
| `src/components/ui/context-menu.tsx:149` | `ContextMenuSeparator` | UI/DEAD | renders JSX |
| `src/components/ui/context-menu.tsx:161` | `ContextMenuShortcut` | UI/DEAD | renders JSX |
| `src/components/ui/dialog.tsx:17` | `DialogOverlay` | UI/DEAD | renders JSX |
| `src/components/ui/dialog.tsx:32` | `DialogContent` | UI/DEAD | renders JSX |
| `src/components/ui/dialog.tsx:56` | `DialogHeader` | UI/DEAD | renders JSX |
| `src/components/ui/dialog.tsx:61` | `DialogFooter` | UI/DEAD | renders JSX |
| `src/components/ui/dialog.tsx:69` | `DialogTitle` | UI/DEAD | renders JSX |
| `src/components/ui/dialog.tsx:81` | `DialogDescription` | UI/DEAD | renders JSX |
| `src/components/ui/drawer.tsx:6` | `Drawer` | UI/DEAD | renders JSX |
| `src/components/ui/drawer.tsx:20` | `DrawerOverlay` | UI/DEAD | renders JSX |
| `src/components/ui/drawer.tsx:32` | `DrawerContent` | UI/DEAD | renders JSX |
| `src/components/ui/drawer.tsx:53` | `DrawerHeader` | UI/DEAD | renders JSX |
| `src/components/ui/drawer.tsx:58` | `DrawerFooter` | UI/DEAD | renders JSX |
| `src/components/ui/drawer.tsx:63` | `DrawerTitle` | UI/DEAD | renders JSX |
| `src/components/ui/drawer.tsx:75` | `DrawerDescription` | UI/DEAD | renders JSX |
| `src/components/ui/dropdown-menu.tsx:21` | `DropdownMenuSubTrigger` | UI/DEAD | renders JSX |
| `src/components/ui/dropdown-menu.tsx:42` | `DropdownMenuSubContent` | UI/DEAD | renders JSX |
| `src/components/ui/dropdown-menu.tsx:57` | `DropdownMenuContent` | UI/DEAD | renders JSX |
| `src/components/ui/dropdown-menu.tsx:76` | `DropdownMenuItem` | UI/DEAD | renders JSX |
| `src/components/ui/dropdown-menu.tsx:94` | `DropdownMenuCheckboxItem` | UI/DEAD | renders JSX |
| `src/components/ui/dropdown-menu.tsx:117` | `DropdownMenuRadioItem` | UI/DEAD | renders JSX |
| `src/components/ui/dropdown-menu.tsx:139` | `DropdownMenuLabel` | UI/DEAD | renders JSX |
| `src/components/ui/dropdown-menu.tsx:153` | `DropdownMenuSeparator` | UI/DEAD | renders JSX |
| `src/components/ui/dropdown-menu.tsx:165` | `DropdownMenuShortcut` | UI/DEAD | renders JSX |
| `src/components/ui/form.tsx:27` | `FormField` | UI/DEAD | renders JSX |
| `src/components/ui/form.tsx:40` | `useFormField` | UI/DEAD | uses a React hook (useFormContext) |
| `src/components/ui/form.tsx:73` | `FormItem` | UI/DEAD | renders JSX |
| `src/components/ui/form.tsx:86` | `FormLabel` | UI/DEAD | uses a React hook (useFormField) |
| `src/components/ui/form.tsx:103` | `FormControl` | UI/DEAD | uses a React hook (useFormField) |
| `src/components/ui/form.tsx:121` | `FormDescription` | UI/DEAD | uses a React hook (useFormField) |
| `src/components/ui/form.tsx:138` | `FormMessage` | UI/DEAD | uses a React hook (useFormField) |
| `src/components/ui/hover-card.tsx:10` | `HoverCardContent` | UI/DEAD | renders JSX |
| `src/components/ui/input-otp.tsx:7` | `InputOTP` | UI/DEAD | renders JSX |
| `src/components/ui/input-otp.tsx:23` | `InputOTPGroup` | UI/DEAD | renders JSX |
| `src/components/ui/input-otp.tsx:31` | `InputOTPSlot` | UI/DEAD | renders JSX |
| `src/components/ui/input-otp.tsx:59` | `InputOTPSeparator` | UI/DEAD | renders JSX |
| `src/components/ui/input.tsx:5` | `Input` | UI/DEAD | renders JSX |
| `src/components/ui/label.tsx:13` | `Label` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:7` | `MenubarMenu` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:11` | `MenubarGroup` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:15` | `MenubarPortal` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:19` | `MenubarRadioGroup` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:23` | `MenubarSub` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:27` | `Menubar` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:42` | `MenubarTrigger` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:57` | `MenubarSubTrigger` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:78` | `MenubarSubContent` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:93` | `MenubarContent` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:113` | `MenubarItem` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:131` | `MenubarCheckboxItem` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:154` | `MenubarRadioItem` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:176` | `MenubarLabel` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:190` | `MenubarSeparator` | UI/DEAD | renders JSX |
| `src/components/ui/menubar.tsx:202` | `MenubarShortcut` | UI/DEAD | renders JSX |
| `src/components/ui/navigation-menu.tsx:8` | `NavigationMenu` | UI/DEAD | renders JSX |
| `src/components/ui/navigation-menu.tsx:23` | `NavigationMenuList` | UI/DEAD | renders JSX |
| `src/components/ui/navigation-menu.tsx:41` | `NavigationMenuTrigger` | UI/DEAD | renders JSX |
| `src/components/ui/navigation-menu.tsx:59` | `NavigationMenuContent` | UI/DEAD | renders JSX |
| `src/components/ui/navigation-menu.tsx:76` | `NavigationMenuViewport` | UI/DEAD | renders JSX |
| `src/components/ui/navigation-menu.tsx:93` | `NavigationMenuIndicator` | UI/DEAD | renders JSX |
| `src/components/ui/pagination.tsx:7` | `Pagination` | UI/DEAD | renders JSX |
| `src/components/ui/pagination.tsx:17` | `PaginationContent` | UI/DEAD | renders JSX |
| `src/components/ui/pagination.tsx:24` | `PaginationItem` | UI/DEAD | renders JSX |
| `src/components/ui/pagination.tsx:34` | `PaginationLink` | UI/DEAD | renders JSX |
| `src/components/ui/pagination.tsx:49` | `PaginationPrevious` | UI/DEAD | renders JSX |
| `src/components/ui/pagination.tsx:65` | `PaginationNext` | UI/DEAD | renders JSX |
| `src/components/ui/pagination.tsx:78` | `PaginationEllipsis` | UI/DEAD | renders JSX |
| `src/components/ui/popover.tsx:12` | `PopoverContent` | UI/DEAD | renders JSX |
| `src/components/ui/progress.tsx:8` | `Progress` | UI/DEAD | renders JSX |
| `src/components/ui/radio-group.tsx:7` | `RadioGroup` | UI/DEAD | renders JSX |
| `src/components/ui/radio-group.tsx:15` | `RadioGroupItem` | UI/DEAD | renders JSX |
| `src/components/ui/resizable.tsx:6` | `ResizablePanelGroup` | UI/DEAD | renders JSX |
| `src/components/ui/resizable.tsx:15` | `ResizableHandle` | UI/DEAD | renders JSX |
| `src/components/ui/scroll-area.tsx:6` | `ScrollArea` | UI/DEAD | renders JSX |
| `src/components/ui/scroll-area.tsx:24` | `ScrollBar` | UI/DEAD | renders JSX |
| `src/components/ui/select.tsx:15` | `SelectTrigger` | UI/DEAD | renders JSX |
| `src/components/ui/select.tsx:35` | `SelectScrollUpButton` | UI/DEAD | renders JSX |
| `src/components/ui/select.tsx:49` | `SelectScrollDownButton` | UI/DEAD | renders JSX |
| `src/components/ui/select.tsx:63` | `SelectContent` | UI/DEAD | renders JSX |
| `src/components/ui/select.tsx:95` | `SelectLabel` | UI/DEAD | renders JSX |
| `src/components/ui/select.tsx:107` | `SelectItem` | UI/DEAD | renders JSX |
| `src/components/ui/select.tsx:129` | `SelectSeparator` | UI/DEAD | renders JSX |
| `src/components/ui/separator.tsx:6` | `Separator` | UI/DEAD | renders JSX |
| `src/components/ui/sheet.tsx:18` | `SheetOverlay` | UI/DEAD | renders JSX |
| `src/components/ui/sheet.tsx:57` | `SheetContent` | UI/DEAD | renders JSX |
| `src/components/ui/sheet.tsx:74` | `SheetHeader` | UI/DEAD | renders JSX |
| `src/components/ui/sheet.tsx:79` | `SheetFooter` | UI/DEAD | renders JSX |
| `src/components/ui/sheet.tsx:87` | `SheetTitle` | UI/DEAD | renders JSX |
| `src/components/ui/sheet.tsx:99` | `SheetDescription` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:40` | `useSidebar` | UI/DEAD | uses React (React) |
| `src/components/ui/sidebar.tsx:49` | `SidebarProvider` | UI/DEAD | uses a React hook (useIsMobile) |
| `src/components/ui/sidebar.tsx:153` | `Sidebar` | UI/DEAD | uses a React hook (useSidebar) |
| `src/components/ui/sidebar.tsx:260` | `SidebarTrigger` | UI/DEAD | uses a React hook (useSidebar) |
| `src/components/ui/sidebar.tsx:286` | `SidebarRail` | UI/DEAD | uses a React hook (useSidebar) |
| `src/components/ui/sidebar.tsx:314` | `SidebarInset` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:331` | `SidebarInput` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:349` | `SidebarHeader` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:363` | `SidebarFooter` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:377` | `SidebarSeparator` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:392` | `SidebarContent` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:409` | `SidebarGroup` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:423` | `SidebarGroupLabel` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:444` | `SidebarGroupAction` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:467` | `SidebarGroupContent` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:479` | `SidebarMenu` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:491` | `SidebarMenuItem` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:525` | `SidebarMenuButton` | UI/DEAD | uses a React hook (useSidebar) |
| `src/components/ui/sidebar.tsx:584` | `SidebarMenuAction` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:615` | `SidebarMenuBadge` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:635` | `SidebarMenuSkeleton` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:668` | `SidebarMenuSub` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:684` | `SidebarMenuSubItem` | UI/DEAD | renders JSX |
| `src/components/ui/sidebar.tsx:689` | `SidebarMenuSubButton` | UI/DEAD | renders JSX |
| `src/components/ui/skeleton.tsx:3` | `Skeleton` | UI/DEAD | renders JSX |
| `src/components/ui/slider.tsx:6` | `Slider` | UI/DEAD | renders JSX |
| `src/components/ui/sonner.tsx:5` | `Toaster` | UI/DEAD | renders JSX |
| `src/components/ui/switch.tsx:6` | `Switch` | UI/DEAD | renders JSX |
| `src/components/ui/table.tsx:5` | `Table` | UI/DEAD | renders JSX |
| `src/components/ui/table.tsx:14` | `TableHeader` | UI/DEAD | renders JSX |
| `src/components/ui/table.tsx:22` | `TableBody` | UI/DEAD | renders JSX |
| `src/components/ui/table.tsx:30` | `TableFooter` | UI/DEAD | renders JSX |
| `src/components/ui/table.tsx:42` | `TableRow` | UI/DEAD | renders JSX |
| `src/components/ui/table.tsx:56` | `TableHead` | UI/DEAD | renders JSX |
| `src/components/ui/table.tsx:71` | `TableCell` | UI/DEAD | renders JSX |
| `src/components/ui/table.tsx:86` | `TableCaption` | UI/DEAD | renders JSX |
| `src/components/ui/tabs.tsx:8` | `TabsList` | UI/DEAD | renders JSX |
| `src/components/ui/tabs.tsx:23` | `TabsTrigger` | UI/DEAD | renders JSX |
| `src/components/ui/tabs.tsx:38` | `TabsContent` | UI/DEAD | renders JSX |
| `src/components/ui/textarea.tsx:5` | `Textarea` | UI/DEAD | renders JSX |
| `src/components/ui/toggle-group.tsx:15` | `ToggleGroup` | UI/DEAD | renders JSX |
| `src/components/ui/toggle-group.tsx:31` | `ToggleGroupItem` | UI/DEAD | renders JSX |
| `src/components/ui/toggle.tsx:29` | `Toggle` | UI/DEAD | renders JSX |
| `src/components/ui/tooltip.tsx:14` | `TooltipContent` | UI/DEAD | renders JSX |
| `src/components/workspace-ui.tsx:11` | `ClassifiedHeader` | UI/DEAD | renders JSX |
| `src/components/workspace-ui.tsx:45` | `TacticalPanel` | UI/DEAD | renders JSX |
| `src/components/workspace-ui.tsx:77` | `EmptyState` | UI/DEAD | renders JSX |
| `src/components/workspace-ui.tsx:102` | `SkeletonLoader` | UI/DEAD | renders JSX |
| `src/components/workspace-ui.tsx:122` | `TableSkeleton` | UI/DEAD | renders JSX |
| `src/data/geo-map.ts:2711` | `worldTopologyUrl` | UI/DEAD | no legacy module or test imports it |
| `src/hooks/use-mobile.tsx:5` | `useIsMobile` | UI/DEAD | uses browser state (window) |
| `src/i18n/dictionary.ts:79` | `translatePhrase` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/i18n/dictionary.ts:139` | `hasTranslation` | UI/DEAD | no legacy module or test imports it |
| `src/i18n/dictionary.ts:147` | `localeCoverage` | UI/DEAD | no legacy module or test imports it |
| `src/i18n/dom-translate.ts:158` | `setTranslationLanguage` | UI/DEAD | uses browser state (document) |
| `src/i18n/dom-translate.ts:166` | `stopTranslation` | UI/DEAD | uses browser state (document) |
| `src/i18n/i18n-context.tsx:44` | `I18nProvider` | UI/DEAD | uses a React hook (useState) |
| `src/i18n/i18n-context.tsx:100` | `useI18n` | UI/DEAD | uses a React hook (useContext) |
| `src/i18n/i18n-context.tsx:107` | `useT` | UI/DEAD | uses a React hook (useI18n) |
| `src/i18n/languages.ts:187` | `getLanguageMeta` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/i18n/languages.ts:191` | `isLangCode` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/lib/error-capture.ts:18` | `consumeLastCapturedError` | IO-BOUND | reads the clock (Date.now) |
| `src/lib/error-page.ts:1` | `renderErrorPage` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/lib/utils.ts:4` | `cn` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/router.tsx:5` | `getRouter` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/routes/live.tsx:33` | `fetchLiveMonitoring` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 36 |
| `src/routes/news.tsx:254` | `safeIsoDate` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/routes/news.tsx:283` | `fetchNews` | FABRICATION-FLAGGED | gate fires 3× (numeric-zero-flattening), first at line 531 |
| `src/routes/news.tsx:575` | `fetchReviews` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/routes/news.tsx:893` | `fetchOSINT` | FABRICATION-FLAGGED | gate fires 2× (string-literal-as-measurement), first at line 1232 |
| `src/routes/news.tsx:1286` | `fetchSearchIntelligence` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/routes/news.tsx:1331` | `generateHandleVariations` | PURE | deterministic; imported only by tests |
| `src/routes/news.tsx:1366` | `getSocialIntelligence` | FABRICATION-FLAGGED | gate fires 3× (numeric-zero-flattening, no-fabricated-fallback), first at line 1524 |
| `src/routes/news.tsx:1878` | `fetchSocialIntelligence` | IO-BOUND | via getSocialIntelligence (this file): calls fetch |
| `src/routes/news.tsx:1885` | `fetchMediaIntelligence` | IO-BOUND | calls fetch |
| `src/routes/osint-verification.tsx:21` | `runOsintVerificationServer` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/routes/osint.tsx:195` | `getSynonymsFor` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/routes/osint.tsx:207` | `getQueryTerms` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/routes/osint.tsx:217` | `matchQuery` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/routes/osint.tsx:226` | `fetchCyberThreats` | IO-BOUND | calls fetch |
| `src/routes/osint.tsx:326` | `fetchTelegramOSINT` | IO-BOUND | via fetchTelegramChannel (src/utils/social.ts): calls fetch |
| `src/routes/osint.tsx:433` | `fetchGpsJamLayer` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/routes/osint.tsx:442` | `fetchRadiationLayer` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/routes/osint.tsx:451` | `fetchGeopoliticalSecurity` | FABRICATION-FLAGGED | gate fires 2× (string-literal-as-measurement), first at line 514 |
| `src/routes/osint.tsx:615` | `fetchRSSAggregator` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/routes/settings.tsx:101` | `getCredentials` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/routes/settings.tsx:105` | `saveCredentials` | IO-BOUND | via requireOperator (src/utils/operator-auth.ts): reads the process environment |
| `src/routes/settings.tsx:117` | `credentialAuthStatus` | IO-BOUND | via vaultAuthStatus (src/utils/operator-auth.ts): reads the process environment |
| `src/start.ts:127` | `startInstance` | IO-BOUND | via rateLimitMiddleware (this file): reads the process environment |
| `src/types/core-adapters.ts:22` | `toAnalysisArticle` | PURE | deterministic; imported only by tests |
| `src/types/core-adapters.ts:48` | `fromAnalysisArticle` | PURE | deterministic; imported only by tests |
| `src/types/core-adapters.ts:107` | `toSocialPost` | PURE | deterministic; imported only by tests |
| `src/types/core-adapters.ts:197` | `fromSocialPost` | PURE | deterministic; imported only by tests |
| `src/types/core-adapters.ts:233` | `toGeoPoint` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/types/core-adapters.ts:250` | `toGpsJamFinding` | PURE | deterministic; imported only by tests |
| `src/types/core.ts:329` | `ContractViolationError` (class) | PURE | deterministic; imported only by tests |
| `src/types/core.ts:355` | `parseArticle` | PURE | deterministic; imported only by tests |
| `src/types/core.ts:358` | `parsePost` | PURE | deterministic; imported only by tests |
| `src/types/core.ts:361` | `parseEntity` | PURE | deterministic; imported only by tests |
| `src/types/core.ts:364` | `parseFinding` | PURE | deterministic; imported only by tests |
| `src/types/core.ts:367` | `parseMediaAsset` | PURE | deterministic; imported only by tests |
| `src/types/core.ts:370` | `parseVideoAsset` | PURE | deterministic; imported only by tests |
| `src/types/core.ts:381` | `parseMany` | PURE | deterministic; imported only by tests |
| `src/utils/active-target.ts:4` | `getActiveTarget` | UI/DEAD | uses browser state (window) |
| `src/utils/active-target.ts:15` | `setActiveTarget` | UI/DEAD | uses browser state (window) |
| `src/utils/active-target.ts:51` | `getActiveTargetType` | UI/DEAD | uses browser state (window) |
| `src/utils/active-target.ts:57` | `setActiveTargetType` | UI/DEAD | uses browser state (window) |
| `src/utils/active-target.ts:83` | `withRecentTarget` | PURE | deterministic; imported only by tests |
| `src/utils/active-target.ts:88` | `getRecentTargets` | UI/DEAD | uses browser state (window) |
| `src/utils/ai-service-client.ts:25` | `AiServiceUnavailableError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/ai-service-client.ts:86` | `aiServiceHealth` | IO-BOUND | calls fetch |
| `src/utils/ai-service-client.ts:113` | `aiServiceDetect` | IO-BOUND | via postForm (this file): calls fetch |
| `src/utils/ai-service-client.ts:125` | `aiServiceDescribe` | IO-BOUND | via postForm (this file): calls fetch |
| `src/utils/ai-service-client.ts:146` | `aiServiceOcrVlm` | IO-BOUND | via postForm (this file): calls fetch |
| `src/utils/ai-service-client.ts:174` | `aiServiceFaces` | IO-BOUND | via postForm (this file): calls fetch |
| `src/utils/ai-service-client.ts:220` | `aiServiceClassifyAudio` | IO-BOUND | via postForm (this file): calls fetch |
| `src/utils/analysis-llm.ts:66` | `summariseArticle` | UI/DEAD | no legacy module or test imports it |
| `src/utils/analysis-llm.ts:138` | `extractEntities` | IO-BOUND | via chatJson (src/utils/llm.ts): calls fetch |
| `src/utils/analysis-llm.ts:233` | `summariseCluster` | UI/DEAD | no legacy module or test imports it |
| `src/utils/analysis-llm.ts:310` | `compareFraming` | UI/DEAD | no legacy module or test imports it |
| `src/utils/analysis-llm.ts:350` | `aiSummariseArticle` | UI/DEAD | no legacy module or test imports it |
| `src/utils/analysis-llm.ts:354` | `aiExtractEntities` | IO-BOUND | via extractEntities (this file): calls fetch |
| `src/utils/analysis-llm.ts:358` | `aiSummariseCluster` | IO-BOUND | via summariseCluster (this file): calls fetch |
| `src/utils/analysis-llm.ts:362` | `aiCompareFraming` | IO-BOUND | via compareFraming (this file): calls fetch |
| `src/utils/analysis.ts:35` | `domainOf` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/analysis.ts:48` | `sourceKeyOf` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/analysis.ts:123` | `titleTokens` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/analysis.ts:135` | `titleSimilarity` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/analysis.ts:246` | `detectLanguage` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/analysis.ts:338` | `stripHtml` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/analysis.ts:371` | `extractKeywords` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 377 |
| `src/utils/analysis.ts:403` | `corpusTerms` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 417 |
| `src/utils/analysis.ts:500` | `clusterStories` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/analysis.ts:557` | `clusterFor` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/analysis.ts:581` | `buildTimeline` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 614 |
| `src/utils/attack-surface.ts:22` | `isPrivateIPv4` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/attack-surface.ts:34` | `isIPv4` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/attack-surface.ts:41` | `toHostname` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/attack-surface.ts:87` | `classifyDevices` | UI/DEAD | no legacy module or test imports it |
| `src/utils/attack-surface.ts:161` | `resolveA` | IO-BOUND | calls fetch |
| `src/utils/attack-surface.ts:199` | `internetDb` | IO-BOUND | calls fetch |
| `src/utils/attack-surface.ts:267` | `lookupAttackSurface` | IO-BOUND | via resolveA (this file): calls fetch |
| `src/utils/audio-events.ts:103` | `groupAudioEvents` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/audio-events.ts:117` | `shouldShowClosestMatches` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/audio-events.ts:121` | `describeCoverage` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/audio-extract-client.ts:47` | `encodeWavPcm16` | PURE | deterministic; imported only by tests |
| `src/utils/audio-extract-client.ts:97` | `decodeAudioSamples` | UI/DEAD | uses browser state (window) |
| `src/utils/audio-extract-client.ts:160` | `extractAudioAsWav` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/audio-extract-client.ts:181` | `analyseAudioFrequencies` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/audio-fingerprint-store.ts:43` | `parseAudioReferences` | PURE | deterministic; imported only by tests |
| `src/utils/audio-fingerprint-store.ts:64` | `getAudioReferences` | UI/DEAD | uses browser state (window) |
| `src/utils/audio-fingerprint-store.ts:95` | `saveAudioReference` | IO-BOUND | via newId (this file): uses randomness (crypto.randomUUID) |
| `src/utils/audio-fingerprint-store.ts:108` | `deleteAudioReference` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/audio-frequency.ts:130` | `fftRadix2` | PURE | deterministic; imported only by tests |
| `src/utils/audio-frequency.ts:184` | `hannWindow` | PURE | deterministic; imported only by tests |
| `src/utils/audio-frequency.ts:206` | `magnitudeSpectrum` | PURE | deterministic; imported only by tests |
| `src/utils/audio-frequency.ts:252` | `refinePeakParabolic` | PURE | deterministic; imported only by tests |
| `src/utils/audio-frequency.ts:271` | `findPeaks` | PURE | deterministic; imported only by tests |
| `src/utils/audio-frequency.ts:311` | `spectralCentroidHz` | UI/DEAD | no legacy module or test imports it |
| `src/utils/audio-frequency.ts:331` | `spectralFlatness` | PURE | deterministic; imported only by tests |
| `src/utils/audio-frequency.ts:347` | `spectralRolloffHz` | UI/DEAD | no legacy module or test imports it |
| `src/utils/audio-frequency.ts:388` | `estimateFundamentalHps` | PURE | deterministic; imported only by tests |
| `src/utils/audio-frequency.ts:468` | `harmonicity` | PURE | deterministic; imported only by tests |
| `src/utils/audio-frequency.ts:795` | `analyseSpectrum` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/audio-frequency.ts:958` | `detectAcousticEvents` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 962 |
| `src/utils/audio-frequency.ts:1093` | `toClassifierFeatures` | PURE | deterministic; imported only by tests |
| `src/utils/audio-frequency.ts:1162` | `describeSpectralAnalysis` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 1169 |
| `src/utils/audio-frequency.ts:1241` | `summariseForAnalyst` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/audio-frequency.ts:1371` | `extractFingerprint` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/audio-frequency.ts:1439` | `compareFingerprints` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/bookmark-store.ts:74` | `migrateBookmarks` | PURE | deterministic; imported only by tests |
| `src/utils/bookmark-store.ts:107` | `getBookmarks` | UI/DEAD | uses browser state (window) |
| `src/utils/bookmark-store.ts:125` | `saveBookmarks` | UI/DEAD | uses browser state (window) |
| `src/utils/bookmark-store.ts:135` | `isBookmarked` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/bookmark-store.ts:140` | `toggleBookmark` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/bookmark-store.ts:156` | `removeBookmark` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/bookmark-store.ts:166` | `setBookmarkCase` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/bookmark-store.ts:190` | `shortlisted` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/bookmark-store.ts:195` | `pinnedBookmarks` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-analysis.ts:115` | `evidenceConfidenceFor` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-analysis.ts:187` | `serializeCaseContext` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-analysis.ts:304` | `buildGroundedPrompt` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-analysis.ts:402` | `assertsCertainty` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-analysis.ts:438` | `validateGroundedAnswer` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-analysis.ts:560` | `analyseCaseGrounded` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-analysis.ts:607` | `llmAnalyseCaseGrounded` | IO-BOUND | via analyseCaseGrounded (this file): calls fetch |
| `src/utils/cases/case-attach.ts:156` | `mergeResultIntoCase` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-attach.ts:262` | `attachResultToCase` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-claims.ts:118` | `caseMediaClaims` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-claims.ts:150` | `isConflicted` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 151 |
| `src/utils/cases/case-claims.ts:162` | `citedEvidenceRefs` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-claims.ts:169` | `claimsHeadline` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-context.ts:193` | `sampleDerivedEntities` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-context.ts:220` | `isSecretKey` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-context.ts:231` | `summariseValue` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-context.ts:296` | `buildCaseContext` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-context.ts:479` | `citableEvidenceIds` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-context.ts:493` | `resolveCitation` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-contradictions.ts:143` | `observedAtByCollector` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-contradictions.ts:166` | `toContradictionInputs` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-contradictions.ts:195` | `isTraceable` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-contradictions.ts:217` | `buildCaseContradictions` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-contradictions.ts:279` | `summariseCaseContradictions` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-delete.ts:85` | `deleteCaseCascade` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-entities.ts:73` | `isResolvedEntity` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-entities.ts:97` | `contributingSourcesOf` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-entities.ts:118` | `resolvedCaseEntities` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-entities.ts:142` | `currentEntityId` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-entities.ts:147` | `resolutionSummary` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-geoint.ts:152` | `isGeointEvidence` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-geoint.ts:163` | `geointEvidenceIn` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-geoint.ts:170` | `geointHypothesisCount` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-geoint.ts:203` | `mergeGeointIntoCase` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-geoint.ts:312` | `attachGeointToCase` | IO-BOUND | via saveGraphSnapshotForCase (src/utils/graph-store.ts): reads the clock (new Date() with no argument) |
| `src/utils/cases/case-intelligence-breakdown.ts:204` | `evidenceByCollector` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-intelligence-breakdown.ts:230` | `entitiesByCollectorId` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-intelligence-breakdown.ts:245` | `relationshipsByCollectorId` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-intelligence-breakdown.ts:265` | `buildCaseIntelligenceBreakdown` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-intelligence-breakdown.ts:458` | `breakdownHeadline` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-report-build.ts:81` | `buildCaseReport` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-report-build.ts:207` | `caseReportBlocker` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-report.ts:147` | `assessCompleteness` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-report.ts:257` | `completenessHeadline` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-report.ts:316` | `toReportContradictions` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-report.ts:385` | `contributionByCollector` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-report.ts:399` | `relationshipsByCollector` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-report.ts:413` | `entitiesByCollector` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-runs.ts:57` | `toCaseStatus` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-runs.ts:97` | `caseNumberOf` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-runs.ts:104` | `toCaseView` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 119 |
| `src/utils/cases/case-runs.ts:123` | `listCases` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-runs.ts:127` | `findCase` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-runs.ts:199` | `runStatusFromJobs` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-runs.ts:241` | `getCaseRuns` | UI/DEAD | uses browser state (window) |
| `src/utils/cases/case-runs.ts:257` | `saveCaseRuns` | UI/DEAD | uses browser state (window) |
| `src/utils/cases/case-runs.ts:277` | `classifyRunInput` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-runs.ts:301` | `createCaseRun` | IO-BOUND | via localId (src/utils/local-id.ts): reads the clock (Date.now) |
| `src/utils/cases/case-runs.ts:320` | `runsForCase` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-runs.ts:327` | `attachOsintRun` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-runs.ts:347` | `setRunStatus` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-runs.ts:357` | `deleteCaseRun` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-runs.ts:362` | `deleteRunsForCase` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-runs.ts:374` | `summariseRuns` | FABRICATION-FLAGGED | gate fires 2× (numeric-zero-flattening), first at line 378 |
| `src/utils/cases/case-scope.ts:90` | `capRecords` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-scope.ts:139` | `isUnscoped` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-scope.ts:148` | `assertSnapshotBelongsToCase` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-scope.ts:192` | `scopedKey` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-scope.ts:197` | `listScopedCases` | UI/DEAD | uses browser state (window) |
| `src/utils/cases/case-scope.ts:229` | `evictOldScopedCases` | UI/DEAD | uses browser state (window) |
| `src/utils/cases/case-scope.ts:250` | `approximateBytes` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-scope.ts:270` | `storageReport` | UI/DEAD | uses browser state (window) |
| `src/utils/cases/case-scope.ts:349` | `getEvictions` | UI/DEAD | uses browser state (window) |
| `src/utils/cases/case-scope.ts:385` | `recordEvictions` | UI/DEAD | uses browser state (window) |
| `src/utils/cases/case-scope.ts:408` | `clearEviction` | UI/DEAD | uses browser state (window) |
| `src/utils/cases/case-scope.ts:416` | `evictionFor` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-scope.ts:422` | `evictedCaseIds` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-scope.ts:436` | `caseSnapshotState` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-snapshot-selection.ts:67` | `noSnapshotMessage` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-snapshot-selection.ts:71` | `noUnscopedMessage` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cases/case-snapshot-selection.ts:84` | `resolveSnapshotSelection` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-snapshot-selection.ts:143` | `optionSuffix` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/case-snapshot-selection.ts:157` | `buildSnapshotOptions` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/cross-intelligence.ts:296` | `buildCrossIntelligence` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cases/cross-intelligence.ts:570` | `summariseCrossIntelligence` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 576 |
| `src/utils/cases/cross-intelligence.ts:593` | `citedEvidenceIds` | UI/DEAD | no legacy module or test imports it |
| `src/utils/cib.ts:44` | `normaliseText` | PURE | deterministic; imported only by tests |
| `src/utils/cib.ts:61` | `contentSimilarity` | PURE | deterministic; imported only by tests |
| `src/utils/cib.ts:77` | `shingles` | PURE | deterministic; imported only by tests |
| `src/utils/cib.ts:89` | `shingleSimilarity` | PURE | deterministic; imported only by tests |
| `src/utils/cib.ts:244` | `temporalSynchrony` | PURE | deterministic; imported only by tests |
| `src/utils/cib.ts:320` | `contentDuplication` | PURE | deterministic; imported only by tests |
| `src/utils/cib.ts:429` | `accountMaturity` | IO-BOUND | reads the clock (Date.now) |
| `src/utils/cib.ts:557` | `handlePatterns` | PURE | deterministic; imported only by tests |
| `src/utils/cib.ts:663` | `amplification` | PURE | deterministic; imported only by tests |
| `src/utils/cib.ts:753` | `clusterPosts` | PURE | deterministic; imported only by tests |
| `src/utils/cib.ts:796` | `observationWindowOf` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/cib.ts:817` | `assessCluster` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 843 |
| `src/utils/cib.ts:871` | `analyseCib` | IO-BOUND | via assessCluster (this file): reads the clock (Date.now) |
| `src/utils/client-ip.ts:58` | `isIPv4Address` | PURE | deterministic; imported only by tests |
| `src/utils/client-ip.ts:62` | `isIPv6Address` | PURE | deterministic; imported only by tests |
| `src/utils/client-ip.ts:75` | `stripAddressDecoration` | PURE | deterministic; imported only by tests |
| `src/utils/client-ip.ts:106` | `collapseIPv6Prefix` | PURE | deterministic; imported only by tests |
| `src/utils/client-ip.ts:174` | `parseTrustedForwardedFor` | PURE | deterministic; imported only by tests |
| `src/utils/client-ip.ts:203` | `resolveClientKey` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/client-ip.ts:247` | `normaliseAddress` | PURE | deterministic; imported only by tests |
| `src/utils/collection-policy.ts:297` | `policyFor` | PURE | deterministic; imported only by tests |
| `src/utils/collection-policy.ts:307` | `policyById` | PURE | deterministic; imported only by tests |
| `src/utils/collection-policy.ts:312` | `allowsAutomatedCollection` | PURE | deterministic; imported only by tests |
| `src/utils/collection-policy.ts:327` | `policySummary` | PURE | deterministic; imported only by tests |
| `src/utils/collector-health.ts:449` | `probeCollectors` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collector-health.ts:460` | `collectorHealth` | IO-BOUND | via probeCollectors (this file): calls fetch |
| `src/utils/collectors/capability-report.ts:60` | `buildCapabilityReport` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/capability-report.ts:80` | `capabilityReport` | IO-BOUND | via buildCapabilityReport (this file): reads the process environment |
| `src/utils/collectors/errors.ts:63` | `CollectorError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/errors.ts:80` | `collectorTimeout` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/errors.ts:89` | `collectorUnavailable` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/errors.ts:94` | `collectorNoCredential` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/existing/crtsh.ts:19` | `crtshCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/existing/dns.ts:22` | `dnsCollector` (object) | IO-BOUND | via resolveA (src/utils/attack-surface.ts): calls fetch |
| `src/utils/collectors/existing/dorks.ts:37` | `dorksCollector` (object) | IO-BOUND | reads the clock (new Date() with no argument) |
| `src/utils/collectors/existing/index.ts:46` | `registerExistingCollectors` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/existing/news.ts:28` | `newsCollector` (object) | IO-BOUND | via collectNewsGeo (src/utils/geo-sources.ts): calls fetch |
| `src/utils/collectors/existing/rdap.ts:123` | `rdapCollector` (object) | IO-BOUND | via queryRdap (this file): calls fetch |
| `src/utils/collectors/existing/shared.ts:19` | `startExecution` | IO-BOUND | reads the clock (new Date() with no argument) |
| `src/utils/collectors/existing/shared.ts:23` | `finishExecution` | IO-BOUND | reads the clock (new Date() with no argument) |
| `src/utils/collectors/existing/shared.ts:47` | `classifyError` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/existing/shared.ts:67` | `collectedNow` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/existing/shared.ts:78` | `normalizeGuard` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/existing/shodan-internetdb.ts:37` | `shodanInternetDbCollector` (object) | IO-BOUND | via resolveAddresses (this file): calls fetch |
| `src/utils/collectors/existing/social.ts:74` | `socialCollector` (object) | IO-BOUND | via fetchTelegramChannel (src/utils/social.ts): calls fetch |
| `src/utils/collectors/existing/wayback.ts:83` | `waybackTimestampToIso` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/existing/wayback.ts:101` | `snapshotUrlFor` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/existing/wayback.ts:110` | `parseCdxRows` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/existing/wayback.ts:164` | `captureSpan` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/existing/wayback.ts:188` | `waybackCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/external/index.ts:41` | `registerExternalCollectors` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/external/ivre.ts:106` | `readScanAuthorisations` | IO-BOUND | reads the process environment |
| `src/utils/collectors/external/ivre.ts:142` | `parseIvrePorts` | PURE | deterministic; imported only by tests |
| `src/utils/collectors/external/ivre.ts:161` | `parseIvreHosts` | PURE | deterministic; imported only by tests |
| `src/utils/collectors/external/ivre.ts:186` | `ivreCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/external/jina-reader.ts:66` | `jinaReaderCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/external/searxng.ts:87` | `parseUnresponsiveEngines` | PURE | deterministic; imported only by tests |
| `src/utils/collectors/external/searxng.ts:103` | `parseSearxngResults` | PURE | deterministic; imported only by tests |
| `src/utils/collectors/external/searxng.ts:122` | `searxngCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/external/sherlock.ts:99` | `normaliseUsername` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/external/sherlock.ts:123` | `parseSherlockPayload` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/external/sherlock.ts:221` | `observationConfidence` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/external/sherlock.ts:244` | `identityConfidence` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/external/sherlock.ts:264` | `sherlockCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/external/spiderfoot.ts:214` | `spiderFootCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/external/theharvester.ts:74` | `parseHostEntry` | PURE | deterministic; imported only by tests |
| `src/utils/collectors/external/theharvester.ts:125` | `theHarvesterCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/passive-policy.ts:70` | `PassivePolicyViolationError` (class) | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/passive-policy.ts:82` | `isPassiveMode` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/passive-policy.ts:94` | `rejectionReasonFor` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/passive-policy.ts:102` | `isPassiveCollector` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/passive-policy.ts:107` | `assertPassiveCollector` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/passive-policy.ts:129` | `filterPassiveCollectors` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/passive-policy.ts:177` | `capabilityMatrixRow` | UI/DEAD | no legacy module or test imports it |
| `src/utils/collectors/passive-policy.ts:201` | `capabilityMatrix` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/person/contact-domain.ts:65` | `contactDomainCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/person/contact-email.ts:268` | `contactEmailCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/person/contact-hibp.ts:43` | `contactHibpCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/person/contact-phone.ts:28` | `contactPhoneCollector` (object) | IO-BOUND | reads the clock (new Date() with no argument) |
| `src/utils/collectors/person/identity-websearch.ts:172` | `identityWebsearchCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/person/index.ts:75` | `registerPersonCollectors` | IO-BOUND | via personInvestigationEnabled (src/utils/osint/person-investigation.ts): reads the process environment |
| `src/utils/collectors/person/index.ts:88` | `resolvePersonCollectorId` | PURE | deterministic; imported only by tests |
| `src/utils/collectors/person/presence-image.ts:14` | `presenceImageCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/person/presence-username.ts:70` | `presenceUsernameCollector` (object) | IO-BOUND | calls fetch |
| `src/utils/collectors/registry.ts:13` | `DuplicateCollectorError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/registry.ts:20` | `CollectorRegistry` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/result.ts:138` | `confidenceBandOf` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/result.ts:156` | `explainConfidence` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/result.ts:393` | `emptyInvestigationResult` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/result.ts:412` | `InvestigationResultValidationError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/collectors/result.ts:425` | `parseInvestigationResult` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credential-vault.ts:65` | `CredentialVaultError` (class) | PURE | deterministic; imported only by tests |
| `src/utils/credential-vault.ts:105` | `normaliseStatus` | PURE | deterministic; imported only by tests |
| `src/utils/credential-vault.ts:440` | `providerById` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credential-vault.ts:478` | `maskSecret` | PURE | deterministic; imported only by tests |
| `src/utils/credential-vault.ts:485` | `secretTail` | PURE | deterministic; imported only by tests |
| `src/utils/credential-vault.ts:490` | `redactEntry` | PURE | deterministic; imported only by tests |
| `src/utils/credential-vault.ts:495` | `redactVault` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credential-vault.ts:512` | `normaliseEntry` | PURE | deterministic; imported only by tests |
| `src/utils/credential-vault.ts:541` | `normaliseVault` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credential-vault.ts:564` | `readVault` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credential-vault.ts:577` | `writeVault` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credential-vault.ts:641` | `resolveCredential` | IO-BOUND | via envValue (this file): reads the process environment |
| `src/utils/credential-vault.ts:683` | `recordCredentialUse` | IO-BOUND | reads the clock (new Date() with no argument) |
| `src/utils/credential-vault.ts:747` | `verifyProviderCredential` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 826 |
| `src/utils/credential-vault.ts:1047` | `normaliseHost` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credential-vault.ts:1094` | `buildCapabilityMatrix` | IO-BOUND | via resolveCredential (this file): reads the process environment |
| `src/utils/credential-vault.ts:1129` | `githubHeaders` | IO-BOUND | via resolveCredential (this file): reads the process environment |
| `src/utils/credential-vault.ts:1148` | `ProviderIdInput` | UI/DEAD | no legacy module or test imports it |
| `src/utils/credential-vault.ts:1207` | `listCredentialProviders` | UI/DEAD | no legacy module or test imports it |
| `src/utils/credential-vault.ts:1212` | `listCredentials` | IO-BOUND | via buildCapabilityMatrix (this file): reads the process environment |
| `src/utils/credential-vault.ts:1223` | `addCredential` | IO-BOUND | via requireOperator (src/utils/operator-auth.ts): reads the process environment |
| `src/utils/credential-vault.ts:1263` | `deleteCredential` | IO-BOUND | via requireOperator (src/utils/operator-auth.ts): reads the process environment |
| `src/utils/credential-vault.ts:1302` | `revealCredential` | IO-BOUND | via configuredOperatorToken (src/utils/operator-auth.ts): reads the process environment |
| `src/utils/credential-vault.ts:1327` | `verifyCredential` | IO-BOUND | via verifyProviderCredential (this file): calls fetch |
| `src/utils/credential-vault.ts:1352` | `capabilityMatrix` | UI/DEAD | no legacy module or test imports it |
| `src/utils/credibility-llm.ts:63` | `assessArticleLanguage` | UI/DEAD | no legacy module or test imports it |
| `src/utils/credibility-llm.ts:95` | `assessLanguageFor` | IO-BOUND | via assessArticleLanguage (this file): calls fetch |
| `src/utils/credibility-llm.ts:121` | `assessmentSummary` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credibility-profiles.ts:45` | `ProfileStoreError` (class) | UI/DEAD | no legacy module or test imports it |
| `src/utils/credibility-profiles.ts:58` | `readProfilesFile` | UI/DEAD | no legacy module or test imports it |
| `src/utils/credibility-profiles.ts:86` | `writeProfilesFile` | UI/DEAD | no legacy module or test imports it |
| `src/utils/credibility-profiles.ts:110` | `serverLoadProfiles` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credibility-profiles.ts:139` | `serverSaveProfiles` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credibility-profiles.ts:150` | `serverDeleteProfile` | UI/DEAD | no legacy module or test imports it |
| `src/utils/credibility.ts:227` | `loadCustomDomainOverrides` | UI/DEAD | uses browser state (window) |
| `src/utils/credibility.ts:239` | `saveCustomDomainOverrides` | UI/DEAD | uses browser state (window) |
| `src/utils/credibility.ts:249` | `reputationOf` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credibility.ts:290` | `analyseCorroboration` | PURE | deterministic; imported only by tests |
| `src/utils/credibility.ts:343` | `corroborationScoreFor` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credibility.ts:395` | `citationScoreFor` | UI/DEAD | no legacy module or test imports it |
| `src/utils/credibility.ts:463` | `diversityScoreFor` | UI/DEAD | no legacy module or test imports it |
| `src/utils/credibility.ts:578` | `defaultFactors` | IO-BOUND | via computeRecency (this file): reads the clock (Date.now) |
| `src/utils/credibility.ts:730` | `bandFor` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credibility.ts:766` | `scoreArticle` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credibility.ts:838` | `scoreCorpus` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credibility.ts:873` | `builtinProfiles` | IO-BOUND | via defaultFactors (this file): reads the clock (Date.now) |
| `src/utils/credibility.ts:922` | `applyProfile` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/credibility.ts:934` | `loadCustomProfiles` | UI/DEAD | uses browser state (window) |
| `src/utils/credibility.ts:947` | `saveCustomProfiles` | UI/DEAD | uses browser state (window) |
| `src/utils/credibility.ts:960` | `loadActiveFactorConfig` | UI/DEAD | uses browser state (window) |
| `src/utils/credibility.ts:975` | `saveActiveFactorConfig` | UI/DEAD | uses browser state (window) |
| `src/utils/cyber-intel.ts:33` | `fetchCyberIntel` | UI/DEAD | no legacy module or test imports it |
| `src/utils/demo-session.ts:51` | `demoProfileFor` | PURE | deterministic; imported only by tests |
| `src/utils/demo-session.ts:65` | `verifyDemoCredentials` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/demo-session.ts:69` | `createDemoSession` | IO-BOUND | reads the clock (new Date() with no argument) |
| `src/utils/demo-session.ts:82` | `parseDemoSession` | PURE | deterministic; imported only by tests |
| `src/utils/demo-session.ts:97` | `safeRedirectTarget` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/demo-session.ts:106` | `readDemoSession` | UI/DEAD | uses browser state (window) |
| `src/utils/demo-session.ts:115` | `writeDemoSession` | UI/DEAD | uses browser state (window) |
| `src/utils/demo-session.ts:126` | `clearDemoSession` | UI/DEAD | uses browser state (window) |
| `src/utils/dorks.ts:207` | `toDomain` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/dorks.ts:232` | `buildDork` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/dorks.ts:270` | `fetchNewsDorkHits` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 312 |
| `src/utils/dorks.ts:321` | `runNewsDork` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/environmental-sources.ts:58` | `createEnvironmentalSources` | IO-BOUND | calls fetch |
| `src/utils/environmental-sources.ts:104` | `fetchNaturalEvents` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/environmental-sources.ts:108` | `fetchSpaceWeather` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/environmental.ts:45` | `parseNaturalEvents` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/environmental.ts:137` | `parseKpReadings` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/environmental.ts:156` | `geomagneticBand` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/environmental.ts:185` | `parseSpaceAlerts` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/environmental.ts:205` | `parseSolarFlares` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/evidence-store.ts:94` | `withoutSeeded` | PURE | deterministic; imported only by tests |
| `src/utils/evidence-store.ts:101` | `getEvidence` | UI/DEAD | uses browser state (window) |
| `src/utils/evidence-store.ts:119` | `saveEvidence` | UI/DEAD | uses browser state (window) |
| `src/utils/evidence-store.ts:136` | `appendEvidence` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/evidence-store.ts:140` | `deleteEvidence` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/evidence-store.ts:147` | `getEvidenceForCase` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/evidence-store.ts:153` | `getUnlinkedEvidence` | PURE | deterministic; imported only by tests |
| `src/utils/evidence-store.ts:158` | `setEvidenceCase` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/evidence-store.ts:175` | `nextEvidenceId` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/evidence-store.ts:202` | `toStoredFileProvenance` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/evidence-store.ts:228` | `buildFileEvidenceRecord` | IO-BOUND | reads the clock (new Date() with no argument) |
| `src/utils/evidence-store.ts:266` | `buildDetectionEvidenceRecord` | IO-BOUND | reads the clock (new Date() with no argument) |
| `src/utils/evidence.ts:19` | `EvidenceIntegrityError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/evidence.ts:34` | `sha256OfFile` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/evidence.ts:47` | `bytesToHex` | UI/DEAD | no legacy module or test imports it |
| `src/utils/evidence.ts:54` | `isSha256` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-handoff.ts:20` | `setFileHandoff` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-handoff.ts:25` | `takeFileHandoff` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance-client.ts:80` | `FileProvenanceError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance-client.ts:119` | `readFileProvenance` | IO-BOUND | reads the clock (new Date() with no argument) |
| `src/utils/file-provenance-client.ts:416` | `verifyChainAgainstStore` | PURE | deterministic; imported only by tests |
| `src/utils/file-provenance-client.ts:491` | `verifyDetachedCms` | PURE | deterministic; imported only by tests |
| `src/utils/file-provenance-client.ts:715` | `readPdfProvenance` | PURE | deterministic; imported only by tests |
| `src/utils/file-provenance-client.ts:1169` | `readOfficeProvenance` | PURE | deterministic; imported only by tests |
| `src/utils/file-provenance-client.ts:1310` | `readVideoContainerProvenance` | UI/DEAD | uses browser state (document) |
| `src/utils/file-provenance-client.ts:1466` | `readRiffProvenance` | UI/DEAD | no legacy module or test imports it |
| `src/utils/file-provenance-client.ts:1495` | `readWebpProvenance` | UI/DEAD | no legacy module or test imports it |
| `src/utils/file-provenance-client.ts:1569` | `readGifProvenance` | UI/DEAD | no legacy module or test imports it |
| `src/utils/file-provenance-client.ts:1594` | `readMp3Provenance` | UI/DEAD | no legacy module or test imports it |
| `src/utils/file-provenance-client.ts:1631` | `readEbmlProvenance` | UI/DEAD | no legacy module or test imports it |
| `src/utils/file-provenance-client.ts:1660` | `readCfbfProvenance` | UI/DEAD | no legacy module or test imports it |
| `src/utils/file-provenance-client.ts:1727` | `readImageProvenance` | UI/DEAD | no legacy module or test imports it |
| `src/utils/file-provenance.ts:195` | `parsePdfDate` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:284` | `parseXmpPacket` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:383` | `interpretPdfInfoDict` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:486` | `interpretPdfDates` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:537` | `countPdfEofMarkers` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:546` | `interpretPdfHiddenActions` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:676` | `parseOoxmlCoreProps` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:705` | `parseOoxmlAppProps` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:719` | `parseOoxmlCustomProps` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:742` | `parseOdfMeta` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:760` | `interpretOfficeDocument` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:883` | `parseRelationshipsXml` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:900` | `interpretOoxmlMacrosAndTemplates` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:937` | `interpretOdfMeta` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:1025` | `parseCfbfHeader` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:1190` | `readCfbfStream` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:1288` | `parseOlepsPropertySet` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:1332` | `interpretCfbfDocument` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:1437` | `parseIsoBmffBoxes` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:1482` | `parseMvhd` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:1525` | `parseIlstTags` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:1553` | `parseIso6709` | PURE | deterministic; imported only by tests |
| `src/utils/file-provenance.ts:1576` | `interpretVideoContainer` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:1722` | `parseRiffChunks` | PURE | deterministic; imported only by tests |
| `src/utils/file-provenance.ts:1743` | `parseRiffContainer` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:1779` | `interpretRiffContainer` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:1814` | `findRiffChunkBytes` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:1875` | `parseEbmlElements` | PURE | deterministic; imported only by tests |
| `src/utils/file-provenance.ts:1927` | `parseEbmlContainer` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:1954` | `interpretEbmlContainer` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:2016` | `parseGifBlocks` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:2107` | `interpretGifInfo` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:2173` | `parseJpegTrailer` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:2230` | `parsePngTrailer` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:2251` | `interpretTrailingData` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:2340` | `parseId3v2Tags` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:2395` | `parseId3v1Tag` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:2427` | `interpretId3Tags` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:2544` | `sniffContainer` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:2561` | `classifyZipEntries` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:2579` | `cannotDetermineFor` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/file-provenance.ts:2647` | `assessFileProvenance` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/focal-point.ts:42` | `detectFocalPoints` | PURE | deterministic; imported only by tests |
| `src/utils/geo-sources.ts:47` | `gisV2Enabled` | IO-BOUND | reads the process environment |
| `src/utils/geo-sources.ts:115` | `collectSeismic` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geo-sources.ts:146` | `collectConflict` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geo-sources.ts:195` | `collectNewsGeo` | IO-BOUND | via getJson (this file): calls fetch |
| `src/utils/geo-sources.ts:244` | `collectGdeltEvents` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geo-sources.ts:317` | `openSkyTracksEnabled` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geo-sources.ts:334` | `collectAssetTracks` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geo-sources.ts:372` | `collectGpsJamming` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geo-sources.ts:409` | `collectRadiation` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geo-sources.ts:462` | `collectReliefWebEvents` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geo-sources.ts:578` | `collectTargetMentions` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geo-sources.ts:683` | `collectGeoLayers` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geo-sources.ts:702` | `fetchGeoLayers` | IO-BOUND | via collectGeoLayers (this file): calls fetch |
| `src/utils/geo.ts:263` | `isRealCoordinate` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geo.ts:366` | `fromLocationMention` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geo.ts:400` | `fromUsgsFeature` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 418 |
| `src/utils/geo.ts:439` | `fromUcdpEvent` | FABRICATION-FLAGGED | gate fires 2× (numeric-zero-flattening, string-literal-as-measurement), first at line 453 |
| `src/utils/geo.ts:514` | `fromGdeltArticle` | FABRICATION-FLAGGED | gate fires 2× (string-literal-as-measurement), first at line 537 |
| `src/utils/geo.ts:603` | `fromGdeltEvent` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geo.ts:678` | `fromOpenSkyState` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geo.ts:741` | `fromReliefWebReport` | FABRICATION-FLAGGED | gate fires 3× (string-literal-as-measurement, no-fabricated-fallback), first at line 765 |
| `src/utils/geo.ts:822` | `fromKplerBalance` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geo.ts:869` | `fromExifImage` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 889 |
| `src/utils/geo.ts:924` | `clusterByGrid` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geo.ts:951` | `cellSizeForZoom` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geo.ts:980` | `timeExtent` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geo.ts:994` | `filterByTime` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geo.ts:1012` | `summarise` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geo.ts:1068` | `webMercatorTile` | PURE | deterministic; imported only by tests |
| `src/utils/geo.ts:1084` | `tileFootprintKm` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geo.ts:1113` | `describeTileRequest` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geo.ts:1138` | `graticuleStepDegrees` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geoint/evidence.ts:146` | `geointGraph` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geoint/geolocation-hypothesis.ts:81` | `HypothesisError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geoint/geolocation-hypothesis.ts:116` | `buildLocationHypothesis` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 150 |
| `src/utils/geoint/geolocation-hypothesis.ts:180` | `describeHypothesis` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geoint/geolocation-hypothesis.ts:196` | `summariseHypotheses` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geoint/image-match.ts:105` | `classifyDistance` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geoint/image-match.ts:117` | `matchesFromDuplicateReport` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geoint/image-match.ts:178` | `ManualMatchError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geoint/image-match.ts:192` | `buildManualMatch` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geoint/image-match.ts:255` | `summariseMatches` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geoint/metadata.ts:117` | `metadataGeoint` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geoint/metadata.ts:237` | `locationEntityId` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geoint/metadata.ts:242` | `locationLabel` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geoint/providers.ts:157` | `providerById` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geoint/providers.ts:161` | `providersFor` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/geoint/providers.ts:166` | `ProviderNotPermittedError` (class) | UI/DEAD | no legacy module or test imports it |
| `src/utils/geoint/providers.ts:187` | `assertProviderPermitted` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geoint/providers.ts:208` | `isProviderAvailable` | UI/DEAD | no legacy module or test imports it |
| `src/utils/geoint/providers.ts:227` | `providerStatuses` | UI/DEAD | no legacy module or test imports it |
| `src/utils/gps-interference.ts:36` | `getCachedGpsInterference` | UI/DEAD | no legacy module or test imports it |
| `src/utils/gps-interference.ts:40` | `classifyGpsRegion` | PURE | deterministic; imported only by tests |
| `src/utils/gps-interference.ts:55` | `groupGpsHexesByRegion` | PURE | deterministic; imported only by tests |
| `src/utils/gps-interference.ts:84` | `parseGpsJamCsv` | UI/DEAD | no legacy module or test imports it |
| `src/utils/gps-interference.ts:101` | `interferencePct` | UI/DEAD | no legacy module or test imports it |
| `src/utils/gps-interference.ts:124` | `GpsJamUnavailableError` (class) | UI/DEAD | no legacy module or test imports it |
| `src/utils/gps-interference.ts:156` | `fetchGpsInterference` | UI/DEAD | no legacy module or test imports it |
| `src/utils/gpsjam-url.ts:45` | `gpsJamUrlForDate` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-build.ts:55` | `normaliseEntityType` | PURE | deterministic; imported only by tests |
| `src/utils/graph-build.ts:81` | `entityKey` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-build.ts:172` | `buildEntityGraph` | FABRICATION-FLAGGED | gate fires 4× (numeric-zero-flattening), first at line 261 |
| `src/utils/graph-build.ts:295` | `degreeCentrality` | FABRICATION-FLAGGED | gate fires 2× (numeric-zero-flattening), first at line 299 |
| `src/utils/graph-build.ts:312` | `shortestPath` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-build.ts:373` | `iterationsFor` | PURE | deterministic; imported only by tests |
| `src/utils/graph-build.ts:391` | `layoutGraph` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-build.ts:482` | `nodeRadius` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-layout.ts:91` | `layoutRadial` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-layout.ts:237` | `shortestPath` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-store.ts:88` | `capGraphSnapshot` | UI/DEAD | no legacy module or test imports it |
| `src/utils/graph-store.ts:139` | `saveGraphSnapshot` | UI/DEAD | uses browser state (window) |
| `src/utils/graph-store.ts:156` | `readGraphSnapshot` | UI/DEAD | uses browser state (window) |
| `src/utils/graph-store.ts:170` | `clearGraphSnapshot` | UI/DEAD | uses browser state (window) |
| `src/utils/graph-store.ts:195` | `getGraphForCase` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-store.ts:219` | `readGraphSnapshotForCase` | UI/DEAD | uses browser state (window) |
| `src/utils/graph-store.ts:235` | `saveGraphSnapshotForCase` | UI/DEAD | uses browser state (window) |
| `src/utils/graph-store.ts:246` | `clearGraphForCase` | UI/DEAD | uses browser state (window) |
| `src/utils/graph-store.ts:256` | `graphScopedCases` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-store.ts:266` | `graphEvictedCases` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-view.ts:156` | `investigationRootId` | PURE | deterministic; imported only by tests |
| `src/utils/graph-view.ts:161` | `viewFromInvestigation` | FABRICATION-FLAGGED | gate fires 4× (numeric-zero-flattening, no-fabricated-fallback), first at line 183 |
| `src/utils/graph-view.ts:292` | `viewFromCorpus` | FABRICATION-FLAGGED | gate fires 2× (string-literal-as-measurement, numeric-zero-flattening), first at line 321 |
| `src/utils/graph-view.ts:357` | `hueFor` | UI/DEAD | no legacy module or test imports it |
| `src/utils/graph-view.ts:362` | `colourFor` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-view.ts:374` | `matchNodes` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-view.ts:412` | `pathBetween` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-view.ts:430` | `typeLegend` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/graph-view.ts:443` | `emptyView` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/highlight.tsx:24` | `highlightMatches` | UI/DEAD | renders JSX |
| `src/utils/highlight.tsx:45` | `Highlight` | UI/DEAD | renders JSX |
| `src/utils/image-sources.ts:144` | `collectNewsImages` | UI/DEAD | no legacy module or test imports it |
| `src/utils/image-sources.ts:194` | `fetchNewsImages` | IO-BOUND | via collectNewsImages (this file): calls fetch |
| `src/utils/image-sources.ts:215` | `collectWikipediaImages` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 235 |
| `src/utils/image-sources.ts:248` | `fetchWikipediaImages` | IO-BOUND | via collectWikipediaImages (this file): calls fetch |
| `src/utils/image-sources.ts:275` | `collectOpenverseImages` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 299 |
| `src/utils/image-sources.ts:311` | `fetchOpenverseImages` | IO-BOUND | via collectOpenverseImages (this file): calls fetch |
| `src/utils/imaging-client.ts:41` | `MediaError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/imaging-client.ts:73` | `loadImageElement` | UI/DEAD | no legacy module or test imports it |
| `src/utils/imaging-client.ts:88` | `decodeImage` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/imaging-client.ts:114` | `hashImage` | UI/DEAD | no legacy module or test imports it |
| `src/utils/imaging-client.ts:121` | `readExif` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/imaging-client.ts:157` | `readC2pa` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/imaging-client.ts:375` | `runOcr` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 401 |
| `src/utils/imaging-client.ts:467` | `extractKeyframes` | UI/DEAD | uses browser state (document) |
| `src/utils/imaging-client.ts:561` | `extractFrameBlob` | UI/DEAD | uses browser state (document) |
| `src/utils/imaging-client.ts:605` | `dataUrlToBlob` | UI/DEAD | no legacy module or test imports it |
| `src/utils/imaging-client.ts:622` | `cropImageRegion` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/imaging-client.ts:660` | `loadImageCorpus` | UI/DEAD | uses browser state (window) |
| `src/utils/imaging-client.ts:671` | `saveImageCorpus` | UI/DEAD | uses browser state (window) |
| `src/utils/imaging-client.ts:682` | `rememberImage` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/imaging.ts:78` | `dct2d` | PURE | deterministic; imported only by tests |
| `src/utils/imaging.ts:116` | `pHash` | PURE | deterministic; imported only by tests |
| `src/utils/imaging.ts:150` | `hammingDistance` | PURE | deterministic; imported only by tests |
| `src/utils/imaging.ts:174` | `rgbaToGrayscale` | PURE | deterministic; imported only by tests |
| `src/utils/imaging.ts:209` | `hashRgba` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/imaging.ts:241` | `grayscaleAutocontrastRgba` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/imaging.ts:346` | `findNearDuplicates` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 376 |
| `src/utils/imaging.ts:502` | `readExifCaptureTime` | PURE | deterministic; imported only by tests |
| `src/utils/imaging.ts:561` | `interpretExif` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/imaging.ts:800` | `interpretC2pa` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/imaging.ts:1001` | `interpretOcr` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/imaging.ts:1064` | `detectSceneCuts` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/imaging.ts:1109` | `assessProvenance` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/investigations-store.ts:75` | `getInvestigations` | UI/DEAD | uses browser state (window) |
| `src/utils/investigations-store.ts:105` | `saveInvestigations` | UI/DEAD | uses browser state (window) |
| `src/utils/investigations-store.ts:122` | `createInvestigation` | FABRICATION-FLAGGED | gate fires 2× (string-literal-as-measurement), first at line 137 |
| `src/utils/investigations-store.ts:155` | `deleteInvestigation` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/investigations-store.ts:172` | `pinToInvestigation` | IO-BOUND | via pinToInvestigationWithId (this file): reads the clock (new Date() with no argument) |
| `src/utils/investigations-store.ts:188` | `pinToInvestigationWithId` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 209 |
| `src/utils/investigations-store.ts:218` | `removeEvidence` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/investigations-store.ts:226` | `updateAnalystNotes` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/investigations-store.ts:271` | `caseMetrics` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 274 |
| `src/utils/investigations-store.ts:334` | `sourcesFromEvidence` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 341 |
| `src/utils/leaflet-client.ts:104` | `resolveTileProvider` | FABRICATION-FLAGGED | gate fires 1× (no-fabricated-fallback), first at line 110 |
| `src/utils/leaflet-client.ts:129` | `loadLeaflet` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/leaflet-client.ts:228` | `addOfflineBasemap` | IO-BOUND | via loadWorldOutlines (this file): calls fetch |
| `src/utils/leaflet-client.ts:255` | `addGraticule` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/leaflet-client.ts:310` | `addScaleBar` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/leaflet-client.ts:321` | `addConsentedTileLayer` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/live-filters.ts:45` | `windowHours` | PURE | deterministic; imported only by tests |
| `src/utils/live-filters.ts:56` | `withinWindow` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/llm.ts:29` | `LlmUnavailableError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/llm.ts:235` | `chat` | IO-BOUND | via chatOnce (this file): calls fetch |
| `src/utils/llm.ts:334` | `chatJson` | IO-BOUND | via chat (this file): calls fetch |
| `src/utils/llm.ts:397` | `summariseText` | UI/DEAD | no legacy module or test imports it |
| `src/utils/llm.ts:419` | `extractEntitiesFrom` | UI/DEAD | no legacy module or test imports it |
| `src/utils/llm.ts:446` | `assessLanguageOf` | UI/DEAD | no legacy module or test imports it |
| `src/utils/llm.ts:493` | `analyseContentOf` | UI/DEAD | no legacy module or test imports it |
| `src/utils/llm.ts:537` | `summarizeCategoryCounts` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/llm.ts:560` | `caseSummaryOf` | UI/DEAD | no legacy module or test imports it |
| `src/utils/llm.ts:587` | `executiveBriefOf` | UI/DEAD | no legacy module or test imports it |
| `src/utils/llm.ts:614` | `reportOf` | UI/DEAD | no legacy module or test imports it |
| `src/utils/llm.ts:664` | `translateTranscriptOf` | UI/DEAD | no legacy module or test imports it |
| `src/utils/llm.ts:738` | `llmTranslateTranscript` | IO-BOUND | via translateTranscriptOf (this file): calls fetch |
| `src/utils/llm.ts:760` | `llmStatsSnapshot` | UI/DEAD | no legacy module or test imports it |
| `src/utils/llm.ts:794` | `llmSummarise` | IO-BOUND | via summariseText (this file): calls fetch |
| `src/utils/llm.ts:798` | `llmExtractEntities` | IO-BOUND | via extractEntitiesFrom (this file): calls fetch |
| `src/utils/llm.ts:802` | `llmAssessLanguage` | IO-BOUND | via assessLanguageOf (this file): calls fetch |
| `src/utils/llm.ts:806` | `llmAnalyseContent` | IO-BOUND | via analyseContentOf (this file): calls fetch |
| `src/utils/llm.ts:810` | `llmCaseSummary` | IO-BOUND | via caseSummaryOf (this file): calls fetch |
| `src/utils/llm.ts:814` | `llmExecutiveBrief` | IO-BOUND | via executiveBriefOf (this file): calls fetch |
| `src/utils/llm.ts:818` | `llmReport` | IO-BOUND | via reportOf (this file): calls fetch |
| `src/utils/llm.ts:822` | `getLlmStats` | IO-BOUND | via llmStatsSnapshot (this file): reads the process environment |
| `src/utils/local-id.ts:18` | `localId` | IO-BOUND | reads the clock (Date.now) |
| `src/utils/local-network.ts:131` | `lookupMacDetails` | UI/DEAD | no legacy module or test imports it |
| `src/utils/local-network.ts:155` | `resolveHostname` | UI/DEAD | no legacy module or test imports it |
| `src/utils/local-network.ts:169` | `resolveMobilePhoneName` | UI/DEAD | no legacy module or test imports it |
| `src/utils/local-network.ts:210` | `getConnectedWifiInfo` | PURE | deterministic; imported only by tests |
| `src/utils/local-network.ts:462` | `scanWifiNetworks` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 467 |
| `src/utils/local-network.ts:514` | `parseLocalNetwork` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 614 |
| `src/utils/local-network.ts:656` | `getLocalNetworkDevices` | IO-BOUND | via parseLocalNetwork (this file): reads the clock (new Date() with no argument) |
| `src/utils/maltego-export.ts:73` | `csvEscape` | PURE | deterministic; imported only by tests |
| `src/utils/maltego-export.ts:96` | `toMaltegoCsv` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/manual-evidence.ts:51` | `AttestationError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/manual-evidence.ts:117` | `isPublicPostUrl` | PURE | deterministic; imported only by tests |
| `src/utils/manual-evidence.ts:137` | `buildAttestedCapture` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/manual-evidence.ts:211` | `attestedCaptureToMediaAsset` | PURE | deterministic; imported only by tests |
| `src/utils/mediaint/claim-conflicts.ts:88` | `detectClaimConflicts` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/mediaint/claim-conflicts.ts:136` | `toContradiction` | UI/DEAD | no legacy module or test imports it |
| `src/utils/mediaint/claim-conflicts.ts:162` | `summariseClaimConflicts` | UI/DEAD | no legacy module or test imports it |
| `src/utils/mediaint/claims.ts:199` | `isOfficialSource` | UI/DEAD | no legacy module or test imports it |
| `src/utils/mediaint/claims.ts:297` | `parseClaimSentence` | UI/DEAD | no legacy module or test imports it |
| `src/utils/mediaint/claims.ts:308` | `candidateSentences` | UI/DEAD | no legacy module or test imports it |
| `src/utils/mediaint/claims.ts:325` | `claimIdFor` | UI/DEAD | no legacy module or test imports it |
| `src/utils/mediaint/claims.ts:347` | `claimKey` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/mediaint/claims.ts:352` | `claimTokens` | UI/DEAD | no legacy module or test imports it |
| `src/utils/mediaint/claims.ts:368` | `claimSimilarity` | UI/DEAD | no legacy module or test imports it |
| `src/utils/mediaint/claims.ts:392` | `claimsMatch` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/mediaint/claims.ts:423` | `isSyndicatedCopy` | UI/DEAD | no legacy module or test imports it |
| `src/utils/mediaint/claims.ts:443` | `extractClaims` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/mediaint/claims.ts:572` | `articlesFromEvidence` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/mediaint/claims.ts:636` | `summariseClaims` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/news-aggregation.ts:85` | `resolveNewsFeeds` | IO-BOUND | reads the process environment |
| `src/utils/news-aggregation.ts:109` | `normalizeNewsUrl` | PURE | deterministic; imported only by tests |
| `src/utils/news-aggregation.ts:186` | `collectNewsAggregation` | IO-BOUND | via fetchOneFeed (this file): calls fetch |
| `src/utils/news-aggregation.ts:220` | `fetchNewsAggregation` | IO-BOUND | via collectNewsAggregation (this file): calls fetch |
| `src/utils/operational-error.ts:66` | `OperationalError` (class) | PURE | deterministic; imported only by tests |
| `src/utils/operational-error.ts:79` | `RateLimitedError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/operational-error.ts:92` | `NotAuthorisedError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/operational-error.ts:114` | `newCorrelationId` | FABRICATION-FLAGGED | gate fires 1× (no-fabricated-fallback), first at line 121 |
| `src/utils/operational-error.ts:134` | `redactInfrastructure` | PURE | deterministic; imported only by tests |
| `src/utils/operational-error.ts:146` | `statusForCode` | PURE | deterministic; imported only by tests |
| `src/utils/operational-error.ts:174` | `sanitiseError` | FABRICATION-FLAGGED | gate fires 2× (no-fabricated-fallback), first at line 206 |
| `src/utils/operational-error.ts:274` | `extractErrno` | PURE | deterministic; imported only by tests |
| `src/utils/operational-error.ts:289` | `toClientError` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/operator-auth.ts:63` | `configuredOperatorToken` | IO-BOUND | reads the process environment |
| `src/utils/operator-auth.ts:81` | `vaultAuthStatus` | IO-BOUND | reads the process environment |
| `src/utils/operator-auth.ts:113` | `tokensMatch` | PURE | deterministic; imported only by tests |
| `src/utils/operator-auth.ts:130` | `requireOperator` | IO-BOUND | reads the process environment |
| `src/utils/operator-auth.ts:156` | `resetOperatorAuthWarning` | PURE | deterministic; imported only by tests |
| `src/utils/operator-auth.ts:166` | `operatorTokenFrom` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint-summary.ts:67` | `buildOverviewModules` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint-summary.ts:179` | `rssEmptyReason` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint-summary.ts:206` | `formatFeedDate` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/contradictions.ts:184` | `detectContradictions` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/contradictions.ts:229` | `describeContradiction` | UI/DEAD | no legacy module or test imports it |
| `src/utils/osint/contradictions.ts:243` | `summariseContradictions` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 248 |
| `src/utils/osint/entity-resolution.ts:45` | `normalizeEmail` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/entity-resolution.ts:50` | `normalizeDomain` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/entity-resolution.ts:55` | `normalizeUsername` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/entity-resolution.ts:60` | `normalizeUrl` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/entity-resolution.ts:73` | `normalizeGeneric` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/entity-resolution.ts:84` | `normalizeEntityValue` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/entity-resolution.ts:105` | `computeMergeConfidence` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/entity-resolution.ts:201` | `resolveEntities` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/entity-resolution.ts:288` | `resolveInvestigationEntities` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/job-store-sqlite.ts:119` | `SqliteJobStore` (class) | IO-BOUND | uses node:fs (existsSync) |
| `src/utils/osint/job-store.ts:88` | `nextId` | IO-BOUND | reads the clock (Date.now) |
| `src/utils/osint/job-store.ts:101` | `InMemoryJobStore` (class) | IO-BOUND | via nextId (this file): reads the clock (Date.now) |
| `src/utils/osint/jobs.ts:261` | `startInvestigation` | IO-BOUND | via runJob (this file): reads the clock (new Date() with no argument) |
| `src/utils/osint/jobs.ts:283` | `cancelJob` | IO-BOUND | reads the clock (new Date() with no argument) |
| `src/utils/osint/jobs.ts:307` | `pollInvestigation` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/jobs.ts:354` | `planOsintInvestigation` | IO-BOUND | via registerPersonCollectors (src/utils/collectors/person/index.ts): reads the process environment |
| `src/utils/osint/jobs.ts:376` | `startOsintInvestigationJob` | IO-BOUND | via registerPersonCollectors (src/utils/collectors/person/index.ts): reads the process environment |
| `src/utils/osint/jobs.ts:403` | `pollOsintInvestigationJob` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/merge.ts:18` | `dedupeEntitiesById` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/merge.ts:25` | `dedupeRelationships` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/merge.ts:53` | `mergeTargetSelfEntities` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/orchestrator.ts:72` | `runInvestigation` | IO-BOUND | reads the clock (new Date() with no argument) |
| `src/utils/osint/orchestrator.ts:150` | `runOsintInvestigation` | IO-BOUND | via registerPersonCollectors (src/utils/collectors/person/index.ts): reads the process environment |
| `src/utils/osint/person-audit-store.ts:37` | `PersonAuditStore` (class) | IO-BOUND | uses node:fs (existsSync) |
| `src/utils/osint/person-investigation.ts:33` | `personInvestigationEnabled` | IO-BOUND | reads the process environment |
| `src/utils/osint/person-investigation.ts:60` | `validateSeeds` | PURE | deterministic; imported only by tests |
| `src/utils/osint/person-investigation.ts:83` | `buildSeedEntities` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/person-investigation.ts:173` | `extractDiscoveredDomains` | PURE | deterministic; imported only by tests |
| `src/utils/osint/person-investigation.ts:202` | `classifyFact` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/person-investigation.ts:209` | `LawfulBasisError` (class) | PURE | deterministic; imported only by tests |
| `src/utils/osint/person-investigation.ts:238` | `assertLawfulBasis` | PURE | deterministic; imported only by tests |
| `src/utils/osint/person-investigation.ts:315` | `__resetAuditStoreForTests` | PURE | deterministic; imported only by tests |
| `src/utils/osint/person-investigation.ts:327` | `startPersonInvestigation` | IO-BOUND | via auditStore (this file): reads the process environment |
| `src/utils/osint/person-investigation.ts:348` | `readPersonInvestigationAudit` | IO-BOUND | via auditStore (this file): reads the process environment |
| `src/utils/osint/person-investigation.ts:364` | `personInvestigationStatus` | IO-BOUND | via personInvestigationEnabled (this file): reads the process environment |
| `src/utils/osint/person-investigation.ts:375` | `startPersonInvestigationAudit` | IO-BOUND | via startPersonInvestigation (this file): reads the process environment |
| `src/utils/osint/person-investigation.ts:389` | `readPersonInvestigationAuditServer` | UI/DEAD | no legacy module or test imports it |
| `src/utils/osint/person-query-planner.ts:21` | `generatePersonSearchQueries` | PURE | deterministic; imported only by tests |
| `src/utils/osint/query-planner.ts:66` | `detectTargetType` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/query-planner.ts:101` | `planInvestigation` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/timeline.ts:82` | `isIsoInstant` | UI/DEAD | no legacy module or test imports it |
| `src/utils/osint/timeline.ts:104` | `observedAtOf` | UI/DEAD | no legacy module or test imports it |
| `src/utils/osint/timeline.ts:111` | `entityOf` | UI/DEAD | no legacy module or test imports it |
| `src/utils/osint/timeline.ts:133` | `claimOf` | UI/DEAD | no legacy module or test imports it |
| `src/utils/osint/timeline.ts:242` | `buildEvidenceTimeline` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/timeline.ts:322` | `entitySpans` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/osint/timeline.ts:379` | `bucketByYear` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 384 |
| `src/utils/osint/verification.ts:82` | `runOsintVerification` | UI/DEAD | no legacy module or test imports it |
| `src/utils/pdf-revocation-client.ts:214` | `checkCertificateRevocation` | IO-BOUND | via checkOcsp (this file): calls fetch |
| `src/utils/pdf-revocation-server.ts:60` | `fetchRevocationEndpoint` | IO-BOUND | calls fetch |
| `src/utils/pdf-revocation-server.ts:100` | `checkRevocationEndpoint` | IO-BOUND | via fetchRevocationEndpoint (this file): calls fetch |
| `src/utils/pdf-revocation.ts:80` | `interpretRevocationChecks` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/radiation.ts:36` | `classifyRadiationLevel` | UI/DEAD | no legacy module or test imports it |
| `src/utils/radiation.ts:46` | `RadiationUnavailableError` (class) | UI/DEAD | no legacy module or test imports it |
| `src/utils/radiation.ts:54` | `toMicroSievertsPerHour` | UI/DEAD | no legacy module or test imports it |
| `src/utils/radiation.ts:78` | `fetchRadiationFeed` | UI/DEAD | no legacy module or test imports it |
| `src/utils/rate-limit-runtime.ts:63` | `rateLimitConfig` | UI/DEAD | no legacy module or test imports it |
| `src/utils/rate-limit-runtime.ts:71` | `rateLimitState` | UI/DEAD | no legacy module or test imports it |
| `src/utils/rate-limit-runtime.ts:81` | `resetRateLimitRuntime` | PURE | deterministic; imported only by tests |
| `src/utils/rate-limit-runtime.ts:129` | `rateLimitDecision` | IO-BOUND | via rateLimitConfig (this file): reads the process environment |
| `src/utils/rate-limit-runtime.ts:178` | `describeDenial` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/rate-limit-runtime.ts:190` | `rateLimitStatus` | UI/DEAD | no legacy module or test imports it |
| `src/utils/rate-limit-tiers.ts:98` | `resolveTier` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/rate-limit-tiers.ts:116` | `classifiedFunctionNames` | PURE | deterministic; imported only by tests |
| `src/utils/rate-limit.ts:119` | `readPositiveInt` | IO-BOUND | reads the process environment |
| `src/utils/rate-limit.ts:139` | `readTierConfig` | IO-BOUND | reads the process environment |
| `src/utils/rate-limit.ts:181` | `readRateLimitConfig` | IO-BOUND | reads the process environment |
| `src/utils/rate-limit.ts:215` | `assertReplicaAssumption` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/rate-limit.ts:248` | `createRateLimitState` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/rate-limit.ts:275` | `keyJitter` | PURE | deterministic; imported only by tests |
| `src/utils/rate-limit.ts:285` | `backoffFor` | UI/DEAD | no legacy module or test imports it |
| `src/utils/rate-limit.ts:296` | `checkRateLimit` | PURE | deterministic; imported only by tests |
| `src/utils/rate-limit.ts:402` | `checkAllDimensions` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/rate-limit.ts:450` | `sweep` | PURE | deterministic; imported only by tests |
| `src/utils/rate-limit.ts:475` | `evictIfNeeded` | PURE | deterministic; imported only by tests |
| `src/utils/rate-limit.ts:511` | `rateLimitSnapshot` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/recon-sources.ts:64` | `parseIssuerOrg` | PURE | deterministic; imported only by tests |
| `src/utils/recon-sources.ts:79` | `isWithinDomain` | PURE | deterministic; imported only by tests |
| `src/utils/recon-sources.ts:143` | `fallbackSubdomains` | UI/DEAD | no legacy module or test imports it |
| `src/utils/recon-sources.ts:211` | `collectCrtShSubdomains` | IO-BOUND | via crtShFetch (this file): calls fetch |
| `src/utils/recon-sources.ts:300` | `crtShSubdomains` | IO-BOUND | via collectCrtShSubdomains (this file): calls fetch |
| `src/utils/report-pdf.ts:216` | `renderProductPdf` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 295 |
| `src/utils/reports.ts:175` | `sourcesFromArticles` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 192 |
| `src/utils/reports.ts:199` | `sourcesFromSocial` | PURE | deterministic; imported only by tests |
| `src/utils/reports.ts:234` | `sourcesFromImages` | PURE | deterministic; imported only by tests |
| `src/utils/reports.ts:254` | `sourcesFromGeo` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/reports.ts:294` | `moduleForCollector` | UI/DEAD | no legacy module or test imports it |
| `src/utils/reports.ts:311` | `sourcesFromOsintEvidence` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/reports.ts:341` | `sourcesFromCaseEvidence` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/reports.ts:375` | `sourcesFromOsintRelationships` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/reports.ts:403` | `renumber` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/reports.ts:578` | `buildSourceContext` | PURE | deterministic; imported only by tests |
| `src/utils/reports.ts:672` | `validateCitations` | PURE | deterministic; imported only by tests |
| `src/utils/reports.ts:743` | `citedSourceNumbers` | PURE | deterministic; imported only by tests |
| `src/utils/reports.ts:775` | `generateProduct` | UI/DEAD | no legacy module or test imports it |
| `src/utils/reports.ts:850` | `toMarkdown` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/reports.ts:1065` | `generateIntelligenceProduct` | IO-BOUND | via generateProduct (this file): calls fetch |
| `src/utils/rss-source.ts:32` | `rssItemBlocks` | PURE | deterministic; imported only by tests |
| `src/utils/rss-source.ts:47` | `publisherUrlsFromRss` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/rss-source.ts:72` | `isAggregatorUrl` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/rss-source.ts:87` | `resolvePublisherUrl` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/scan-authorization.ts:74` | `ScanNotAuthorisedError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/scan-authorization.ts:88` | `normaliseScanTarget` | PURE | deterministic; imported only by tests |
| `src/utils/scan-authorization.ts:103` | `isIPv4` | UI/DEAD | no legacy module or test imports it |
| `src/utils/scan-authorization.ts:108` | `ipv4ToInt` | PURE | deterministic; imported only by tests |
| `src/utils/scan-authorization.ts:124` | `parseCidr` | PURE | deterministic; imported only by tests |
| `src/utils/scan-authorization.ts:141` | `cidrContains` | PURE | deterministic; imported only by tests |
| `src/utils/scan-authorization.ts:159` | `isWithinDomain` | PURE | deterministic; imported only by tests |
| `src/utils/scan-authorization.ts:171` | `isPrivateOrReservedIPv4` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/scan-authorization.ts:194` | `recordCoversTarget` | PURE | deterministic; imported only by tests |
| `src/utils/scan-authorization.ts:208` | `findScanAuthorisation` | PURE | deterministic; imported only by tests |
| `src/utils/scan-authorization.ts:246` | `assertScanAuthorised` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/scan-authorization.ts:321` | `scanAuditEntry` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/search.ts:36` | `normalizeQuery` | UI/DEAD | no legacy module or test imports it |
| `src/utils/search.ts:49` | `parseQuery` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/search.ts:145` | `containsWord` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/search.ts:154` | `containsAnyWord` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/search.ts:175` | `matchesQuery` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/search.ts:217` | `scoreMatch` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/search.ts:254` | `buildUpstreamQuery` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/search.ts:278` | `buildPlainQuery` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/search.ts:292` | `parseQueryCached` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/security-headers.ts:35` | `contentSecurityPolicy` | PURE | deterministic; imported only by tests |
| `src/utils/security-headers.ts:76` | `cspMode` | IO-BOUND | reads the process environment |
| `src/utils/security-headers.ts:88` | `securityHeaders` | IO-BOUND | reads the process environment |
| `src/utils/security-headers.ts:141` | `withSecurityHeaders` | IO-BOUND | via securityHeaders (this file): reads the process environment |
| `src/utils/security-headers.ts:161` | `isHttpsRequest` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/social-attach.ts:45` | `directSocialPostsToResult` | IO-BOUND | via socialCollector (src/utils/collectors/existing/social.ts): calls fetch |
| `src/utils/social-credibility.ts:45` | `postToArticle` | PURE | deterministic; imported only by tests |
| `src/utils/social-credibility.ts:57` | `postsToArticles` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/social-credibility.ts:70` | `buildSocialContext` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 103 |
| `src/utils/social-credibility.ts:155` | `socialFactors` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/social-credibility.ts:216` | `clusterAcrossModes` | PURE | deterministic; imported only by tests |
| `src/utils/social-credibility.ts:280` | `assessSocialCorpus` | IO-BOUND | via analyseCib (src/utils/cib.ts): reads the clock (Date.now) |
| `src/utils/social-credibility.ts:298` | `socialSourceKey` | UI/DEAD | no legacy module or test imports it |
| `src/utils/social-velocity.ts:80` | `calculateSocialVelocity` | FABRICATION-FLAGGED | gate fires 3× (numeric-zero-flattening), first at line 117 |
| `src/utils/social.ts:55` | `SocialUnavailableError` (class) | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/social.ts:277` | `blueskyMediaFromRecord` | PURE | deterministic; imported only by tests |
| `src/utils/social.ts:323` | `blueskyMediaFromView` | PURE | deterministic; imported only by tests |
| `src/utils/social.ts:381` | `redditMediaFrom` | PURE | deterministic; imported only by tests |
| `src/utils/social.ts:462` | `telegramMediaFrom` | PURE | deterministic; imported only by tests |
| `src/utils/social.ts:506` | `mastodonMediaFrom` | PURE | deterministic; imported only by tests |
| `src/utils/social.ts:524` | `eventToPost` | IO-BOUND | reads the clock (Date.now) |
| `src/utils/social.ts:561` | `RingBuffer` (class) | PURE | deterministic; imported only by tests |
| `src/utils/social.ts:589` | `JetstreamClient` (class) | IO-BOUND | opens a WebSocket |
| `src/utils/social.ts:756` | `monitorMatches` | PURE | deterministic; imported only by tests |
| `src/utils/social.ts:799` | `assessSpike` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 803 |
| `src/utils/social.ts:878` | `observationTime` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/social.ts:886` | `bucketise` | PURE | deterministic; imported only by tests |
| `src/utils/social.ts:912` | `readMonitor` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 933 |
| `src/utils/social.ts:1030` | `fetchProfile` | UI/DEAD | no legacy module or test imports it |
| `src/utils/social.ts:1041` | `fetchProfiles` | UI/DEAD | no legacy module or test imports it |
| `src/utils/social.ts:1073` | `fetchAuthorFeed` | IO-BOUND | via appview (this file): calls fetch |
| `src/utils/social.ts:1131` | `resetBlueskySession` | UI/DEAD | no legacy module or test imports it |
| `src/utils/social.ts:1215` | `fetchBlueskySearch` | UI/DEAD | no legacy module or test imports it |
| `src/utils/social.ts:1322` | `redditCredentials` | IO-BOUND | reads the process environment |
| `src/utils/social.ts:1340` | `resolveRedditCredentials` | IO-BOUND | via redditCredentials (this file): reads the process environment |
| `src/utils/social.ts:1366` | `resetRedditToken` | PURE | deterministic; imported only by tests |
| `src/utils/social.ts:1449` | `fetchRedditSearch` | IO-BOUND | calls fetch |
| `src/utils/social.ts:1547` | `splitTelegramMessages` | PURE | deterministic; imported only by tests |
| `src/utils/social.ts:1573` | `decodeTelegramHtml` | UI/DEAD | no legacy module or test imports it |
| `src/utils/social.ts:1602` | `telegramBlockToPost` | PURE | deterministic; imported only by tests |
| `src/utils/social.ts:1658` | `fetchTelegramChannel` | IO-BOUND | calls fetch |
| `src/utils/social.ts:1790` | `resolveMastodonHost` | UI/DEAD | no legacy module or test imports it |
| `src/utils/social.ts:1835` | `stripMastodonHtml` | PURE | deterministic; imported only by tests |
| `src/utils/social.ts:1850` | `mastodonLinks` | PURE | deterministic; imported only by tests |
| `src/utils/social.ts:1870` | `fetchMastodonTag` | IO-BOUND | calls fetch |
| `src/utils/social.ts:1958` | `mastodonStatusToPost` | UI/DEAD | no legacy module or test imports it |
| `src/utils/social.ts:1996` | `fetchMastodonSearch` | UI/DEAD | no legacy module or test imports it |
| `src/utils/social.ts:2310` | `socialProfile` | IO-BOUND | via fetchProfile (this file): calls fetch |
| `src/utils/social.ts:2314` | `socialProfiles` | IO-BOUND | via fetchProfiles (this file): calls fetch |
| `src/utils/social.ts:2318` | `socialAuthorFeed` | IO-BOUND | via fetchAuthorFeed (this file): calls fetch |
| `src/utils/social.ts:2322` | `socialReddit` | IO-BOUND | via fetchRedditSearch (this file): calls fetch |
| `src/utils/social.ts:2326` | `socialTelegram` | IO-BOUND | via fetchTelegramChannel (this file): calls fetch |
| `src/utils/social.ts:2330` | `socialMastodon` | IO-BOUND | via fetchMastodonTag (this file): calls fetch |
| `src/utils/social.ts:2335` | `socialBlueskySearch` | UI/DEAD | no legacy module or test imports it |
| `src/utils/social.ts:2340` | `socialMastodonSearch` | UI/DEAD | no legacy module or test imports it |
| `src/utils/social.ts:2351` | `socialCredentials` | IO-BOUND | via resolveRedditCredentials (this file): reads the process environment |
| `src/utils/source-cache.ts:16` | `createCachedSource` | IO-BOUND | reads the clock (Date.now) |
| `src/utils/supply-demand-sources.ts:69` | `collectSupplyDemand` | UI/DEAD | no legacy module or test imports it |
| `src/utils/supply-demand-sources.ts:156` | `fetchSupplyDemand` | IO-BOUND | via collectSupplyDemand (this file): calls fetch |
| `src/utils/telegram-intel.ts:59` | `classifyTelegramPost` | UI/DEAD | no legacy module or test imports it |
| `src/utils/telegram-intel.ts:89` | `processTelegramIntelFeed` | UI/DEAD | no legacy module or test imports it |
| `src/utils/theme.ts:19` | `getThemePreference` | UI/DEAD | uses browser state (window) |
| `src/utils/theme.ts:26` | `resolveTheme` | UI/DEAD | uses browser state (window) |
| `src/utils/theme.ts:32` | `setThemePreference` | UI/DEAD | uses browser state (window) |
| `src/utils/threat-classifier.ts:86` | `classifyThreatText` | PURE | deterministic; imported only by tests |
| `src/utils/timeline-store.ts:65` | `capTimelineSnapshot` | UI/DEAD | no legacy module or test imports it |
| `src/utils/timeline-store.ts:94` | `saveTimelineSnapshot` | UI/DEAD | uses browser state (window) |
| `src/utils/timeline-store.ts:108` | `readTimelineSnapshot` | UI/DEAD | uses browser state (window) |
| `src/utils/timeline-store.ts:118` | `clearTimelineSnapshot` | UI/DEAD | uses browser state (window) |
| `src/utils/timeline-store.ts:135` | `getTimelineForCase` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/timeline-store.ts:145` | `readTimelineSnapshotForCase` | UI/DEAD | uses browser state (window) |
| `src/utils/timeline-store.ts:151` | `saveTimelineSnapshotForCase` | UI/DEAD | uses browser state (window) |
| `src/utils/timeline-store.ts:160` | `clearTimelineForCase` | UI/DEAD | uses browser state (window) |
| `src/utils/timeline-store.ts:170` | `timelineScopedCases` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/timeline-store.ts:180` | `timelineEvictedCases` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/timeline.ts:30` | `timelineFromGdeltEvents` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/timeline.ts:45` | `timelineFromNewsItems` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/timeline.ts:62` | `mergeTimeline` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/transcription.ts:42` | `TranscriptionUnavailableError` (class) | PURE | deterministic; imported only by tests |
| `src/utils/transcription.ts:113` | `sarvamContentType` | PURE | deterministic; imported only by tests |
| `src/utils/transcription.ts:277` | `checkTranscriptionJob` | IO-BOUND | calls fetch |
| `src/utils/transcription.ts:343` | `startTranscription` | IO-BOUND | via transcribeSync (this file): calls fetch |
| `src/utils/transcription.ts:359` | `startAudioTranscription` | IO-BOUND | via startTranscription (this file): calls fetch |
| `src/utils/transcription.ts:375` | `pollAudioTranscription` | IO-BOUND | via checkTranscriptionJob (this file): calls fetch |
| `src/utils/validation.ts:42` | `InputContractError` (class) | PURE | deterministic; imported only by tests |
| `src/utils/validation.ts:68` | `validate` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/validation.ts:85` | `boundedText` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/validation.ts:93` | `boundedOptionalText` | UI/DEAD | no legacy module or test imports it |
| `src/utils/validation.ts:106` | `identifierLike` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/validation.ts:154` | `positiveLimit` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/validation.ts:163` | `boundedScore` | PURE | deterministic; imported only by tests |
| `src/utils/validation.ts:173` | `boundedArray` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/validation.ts:187` | `jsonSizeLimit` | FABRICATION-FLAGGED | gate fires 1× (numeric-zero-flattening), first at line 191 |
| `src/utils/validation.ts:230` | `isBlockedHost` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/validation.ts:242` | `bareHost` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/validation.ts:269` | `hostAllowlist` | IO-BOUND | reads the process environment |
| `src/utils/validation.ts:297` | `allowedHosts` | IO-BOUND | reads the process environment |
| `src/utils/validation.ts:321` | `httpUrlWithHostAllowlist` | IO-BOUND | reads the process environment |
| `src/utils/validation.ts:357` | `absoluteHttpUrl` | PURE | deterministic; imported only by tests |
| `src/utils/vehicle-osint.ts:177` | `isVin` | PURE | deterministic; imported only by tests |
| `src/utils/vehicle-osint.ts:182` | `isRegistrationPlate` | PURE | deterministic; imported only by tests |
| `src/utils/vehicle-osint.ts:187` | `lookupVehicleIntelligence` | FABRICATION-FLAGGED | gate fires 4× (string-literal-as-measurement), first at line 393 |
| `src/utils/vehicle-osint.ts:408` | `fetchVehicleOSINT` | IO-BOUND | via lookupVehicleIntelligence (this file): calls fetch |
| `src/utils/watchlist-store.ts:136` | `migrateWatchlists` | PURE | deterministic; imported only by tests |
| `src/utils/watchlist-store.ts:143` | `getWatchlists` | UI/DEAD | uses browser state (window) |
| `src/utils/watchlist-store.ts:165` | `saveWatchlists` | UI/DEAD | uses browser state (window) |
| `src/utils/watchlist-store.ts:172` | `createWatchlist` | FABRICATION-FLAGGED | gate fires 2× (string-literal-as-measurement), first at line 180 |
| `src/utils/watchlist-store.ts:193` | `deleteWatchlist` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/watchlist-store.ts:199` | `getWatchlistMatches` | IO-BOUND | via localId (src/utils/local-id.ts): reads the clock (Date.now) |
| `src/utils/watchlist-store.ts:377` | `bucketMatchesByHour` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/youtube-collector.ts:122` | `isYoutubeUrl` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/youtube-collector.ts:140` | `extractYoutubeId` | PURE | deterministic: no I/O, clock, randomness, browser or process state |
| `src/utils/youtube-collector.ts:157` | `fmtUploadDate` | PURE | deterministic; imported only by tests |
| `src/utils/youtube-collector.ts:297` | `muxedFormats` | PURE | deterministic; imported only by tests |
| `src/utils/youtube-collector.ts:310` | `captionTracksOf` | PURE | deterministic; imported only by tests |
| `src/utils/youtube-collector.ts:336` | `captionTracksToLangs` | PURE | deterministic; imported only by tests |
| `src/utils/youtube-collector.ts:372` | `decodeXmlEntities` | PURE | deterministic; imported only by tests |
| `src/utils/youtube-collector.ts:380` | `parseVttSegments` | PURE | deterministic; imported only by tests |
| `src/utils/youtube-collector.ts:437` | `parseTimedTextXml` | PURE | deterministic; imported only by tests |
| `src/utils/youtube-collector.ts:475` | `parseSubtitleBody` | PURE | deterministic; imported only by tests |
| `src/utils/youtube-collector.ts:573` | `searchYoutubeVideos` | IO-BOUND | calls fetch |
| `src/utils/youtube-collector.ts:1083` | `fetchYoutubeComments` | FABRICATION-FLAGGED | gate fires 1× (string-literal-as-measurement), first at line 1138 |
| `src/utils/youtube-collector.ts:1229` | `serverSearchYoutubeVideos` | IO-BOUND | via searchYoutubeVideos (this file): calls fetch |
| `src/utils/youtube-collector.ts:1233` | `serverFetchYoutubeComments` | IO-BOUND | via fetchYoutubeComments (this file): calls fetch |
| `src/utils/youtube-collector.ts:1237` | `serverFetchYoutubeMetadata` | IO-BOUND | via _getMetadata (this file): calls fetch |
| `src/utils/youtube-collector.ts:1241` | `serverFetchYoutubeSubtitles` | IO-BOUND | via _getSubtitles (this file): calls fetch |
| `src/utils/youtube-collector.ts:1245` | `serverDownloadYoutubeVideo` | IO-BOUND | via _getDownloadUrl (this file): calls fetch |
