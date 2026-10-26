import type { Company, CompanySettings, UpdateCompanyRequest, UpdateCompanySettingsRequest } from "@/types";
import { apiRequest } from "./client";

export const companyApi = {
  get: () => apiRequest<{ company: Company }>("/company"),
  update: (input: UpdateCompanyRequest) => apiRequest<{ company: Company }>("/company", { method: "PATCH", body: input }),
  getSettings: () => apiRequest<{ settings: CompanySettings }>("/company/settings"),
  updateSettings: (input: UpdateCompanySettingsRequest) =>
    apiRequest<{ settings: CompanySettings }>("/company/settings", { method: "PATCH", body: input }),
};
