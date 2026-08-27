import { ActivatedRoute, Router } from '@angular/router';

export const LIST_FILTER_PARAM = 'filter';
export const FROM_TOPIC_PARAM = 'fromTopic';

export function listFilterQueryParams(value: string): Record<string, string | null> {
  return { [LIST_FILTER_PARAM]: value.trim() ? value : null };
}

export function persistListFilter(router: Router, route: ActivatedRoute, value: string): void {
  void router.navigate([], {
    relativeTo: route,
    queryParams: listFilterQueryParams(value),
    queryParamsHandling: 'merge',
    replaceUrl: true,
  });
}

export function listFilterNavExtras(value: string): { queryParams: Record<string, string> } | Record<string, never> {
  const trimmed = value.trim();
  return trimmed ? { queryParams: { [LIST_FILTER_PARAM]: trimmed } } : {};
}
