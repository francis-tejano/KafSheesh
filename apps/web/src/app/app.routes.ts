import { Routes } from '@angular/router';
import { ShellComponent } from './layout/shell.component';
import { AuditPage } from './pages/audit/audit.page';
import { BrokersPage } from './pages/brokers/brokers.page';
import { ClusterWizardPage } from './pages/cluster-wizard/cluster-wizard.page';
import { ClustersPage } from './pages/clusters/clusters.page';
import { GroupsPage } from './pages/groups/groups.page';
import { OverviewPage } from './pages/overview/overview.page';
import { SchemasPage } from './pages/schemas/schemas.page';
import { TopicDetailPage } from './pages/topic-detail/topic-detail.page';
import { TopicsPage } from './pages/topics/topics.page';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'clusters' },
  { path: 'clusters', component: ClustersPage },
  { path: 'clusters/new', component: ClusterWizardPage },
  { path: 'clusters/:id/edit', component: ClusterWizardPage },
  {
    path: 'c/:id',
    component: ShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      { path: 'overview', component: OverviewPage },
      { path: 'topics', component: TopicsPage },
      { path: 'topics/:name', component: TopicDetailPage },
      { path: 'groups', component: GroupsPage },
      { path: 'brokers', component: BrokersPage },
      { path: 'schemas', component: SchemasPage },
      { path: 'audit', component: AuditPage },
    ],
  },
];
