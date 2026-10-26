import { Role } from "@dbi/api-types";

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
      serviceName?: string;
    }
  }
}

export {};
