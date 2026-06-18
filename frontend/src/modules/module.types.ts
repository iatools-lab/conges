export type UserGroup = "public" | "employee" | "manager" | "rh" | "admin" | "shared";

export type FrontendSubmodule = {
  id: string;
  label: string;
  path: string;
  description?: string;
};

export type FrontendModule = {
  id: UserGroup;
  label: string;
  basePath: string;
  submodules: readonly FrontendSubmodule[];
};
