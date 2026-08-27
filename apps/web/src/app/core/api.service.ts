import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AuditEvent,
  BrokerInfo,
  ClusterOverview,
  ClusterSummary,
  ConnectionDiagnostic,
  ConsumerGroupInfo,
  CreateClusterInput,
  KafkaMessage,
  ResetOffsetsInput,
  SavedSearch,
  SchemaSubject,
  TopicDetail,
  TopicInfo,
  UpdateClusterInput,
} from '@kafsheesh/shared';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  listClusters() {
    return this.http.get<ClusterSummary[]>('/api/clusters');
  }

  getCluster(id: string) {
    return this.http.get<ClusterSummary>(`/api/clusters/${id}`);
  }

  createCluster(body: CreateClusterInput) {
    return this.http.post<ClusterSummary>('/api/clusters', body);
  }

  updateCluster(id: string, body: UpdateClusterInput) {
    return this.http.put<ClusterSummary>(`/api/clusters/${id}`, body);
  }

  deleteCluster(id: string) {
    return this.http.delete(`/api/clusters/${id}`);
  }

  connect(id: string) {
    return this.http.post(`/api/clusters/${id}/connect`, {});
  }

  disconnect(id: string) {
    return this.http.post(`/api/clusters/${id}/disconnect`, {});
  }

  diagnose(id: string) {
    return this.http.post<ConnectionDiagnostic>(`/api/clusters/${id}/diagnose`, {});
  }

  overview(id: string) {
    return this.http.get<ClusterOverview>(`/api/clusters/${id}/overview`);
  }

  topics(id: string, query?: { stats?: boolean }) {
    let params = new HttpParams();
    if (query?.stats) {
      params = params.set('stats', '1');
    }
    return this.http.get<TopicInfo[]>(`/api/clusters/${id}/topics`, { params });
  }

  topic(id: string, name: string) {
    return this.http.get<TopicDetail>(`/api/clusters/${id}/topics/${encodeURIComponent(name)}`);
  }

  createTopic(id: string, body: { name: string; partitions: number; replicationFactor: number }) {
    return this.http.post(`/api/clusters/${id}/topics`, body);
  }

  deleteTopic(id: string, name: string) {
    return this.http.delete(`/api/clusters/${id}/topics/${encodeURIComponent(name)}`);
  }

  messages(
    id: string,
    topic: string,
    query: { limit?: number; direction?: string; q?: string; jsonPath?: string; partition?: number },
  ) {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<KafkaMessage[]>(
      `/api/clusters/${id}/topics/${encodeURIComponent(topic)}/messages`,
      { params },
    );
  }

  produce(id: string, body: { topic: string; key?: string; value: string; partition?: number }) {
    return this.http.post(`/api/clusters/${id}/messages`, body);
  }

  groups(id: string) {
    return this.http.get<ConsumerGroupInfo[]>(`/api/clusters/${id}/groups`);
  }

  resetOffsets(id: string, body: ResetOffsetsInput) {
    return this.http.post(`/api/clusters/${id}/groups/reset`, body);
  }

  deleteGroup(id: string, groupId: string) {
    return this.http.delete(`/api/clusters/${id}/groups/${encodeURIComponent(groupId)}`);
  }

  brokers(id: string) {
    return this.http.get<BrokerInfo[]>(`/api/clusters/${id}/brokers`);
  }

  schemas(id: string) {
    return this.http.get<SchemaSubject[]>(`/api/clusters/${id}/schemas`);
  }

  createSchema(id: string, body: { subject: string; schema: string; schemaType?: string }) {
    return this.http.post(`/api/clusters/${id}/schemas`, body);
  }

  deleteSchema(id: string, subject: string) {
    return this.http.delete(`/api/clusters/${id}/schemas/${encodeURIComponent(subject)}`);
  }

  searches(id: string) {
    return this.http.get<SavedSearch[]>(`/api/clusters/${id}/searches`);
  }

  saveSearch(id: string, body: { name: string; topic: string; q?: string; jsonPath?: string }) {
    return this.http.post<SavedSearch>(`/api/clusters/${id}/searches`, body);
  }

  audit(id?: string) {
    return id
      ? this.http.get<AuditEvent[]>(`/api/clusters/${id}/audit`)
      : this.http.get<AuditEvent[]>('/api/audit');
  }
}
