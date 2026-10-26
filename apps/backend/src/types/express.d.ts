import { CompanyRole, Role } from "@dbi/api-types";
import type { ICameraDocument } from "../models/Camera";
import type { ISiteDocument } from "../models/Site";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: {
        id: string;
        email?: string;
        role: Role | string;
        status?: string;
        name?: string;
      };
      // Set by resolveTenant: the company this request acts in, derived from membership.
      tenant?: {
        companyId: string;
        role: CompanyRole;
        siteIds: string[];
        memberId: string;
      };
      site?: ISiteDocument;
      camera?: ICameraDocument;
      serviceName?: string;
    }
  }
}

export {};
