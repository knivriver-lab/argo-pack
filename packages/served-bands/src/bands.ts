/**
 * The four bands, and the served route each one is a view of.
 *
 * A band is a name, a view, and one route. It is not a query language and it is not a place to
 * put a filter: if a band needs different data, the fabric grows a route and this table gains a
 * line. That is the whole extent of what a band gets to decide.
 *
 * The routes are paths. The origin comes from the operator's `mewd.fabric.baseUrl`, and appears
 * nowhere in this repository.
 */

export type BandId = 'needs-you' | 'helm' | 'berths' | 'map';

export interface Band {
  readonly id: BandId;
  /** The view id contributed in `package.json`. */
  readonly viewId: string;
  readonly title: string;
  /** Path under the fabric's origin. Never an absolute URL. */
  readonly route: string;
  /** Shown in the view before the first answer arrives, and when there is nothing to show. */
  readonly blurb: string;
}

export const BANDS: readonly Band[] = [
  {
    id: 'needs-you',
    viewId: 'mewd.needsYou',
    title: 'Needs you',
    route: '/dashboard/attention',
    blurb: 'What is waiting on a person. Empty here means nothing is waiting on you.',
  },
  {
    id: 'helm',
    viewId: 'mewd.helm',
    title: 'Helm',
    route: '/dashboard/coordination',
    blurb: 'What is being coordinated right now, and by whom.',
  },
  {
    id: 'berths',
    viewId: 'mewd.berths',
    title: 'Berths',
    route: '/dashboard/sessions',
    blurb: 'The sessions the fabric is holding, and what each one is tied up doing.',
  },
  {
    id: 'map',
    viewId: 'mewd.map',
    title: 'Map',
    route: '/dashboard/chart',
    blurb: 'The chart: where the work is, as the fabric sees it.',
  },
];

export function bandById(id: string): Band | undefined {
  return BANDS.find((band) => band.id === id);
}

export function bandByViewId(viewId: string): Band | undefined {
  return BANDS.find((band) => band.viewId === viewId);
}

/** `<baseUrl><route>`, with exactly one slash between them and no guessing about the rest. */
export function urlFor(baseUrl: string, band: Band): string {
  return `${baseUrl.replace(/\/+$/, '')}${band.route}`;
}
