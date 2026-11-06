"use client";

import { createContext, useContext } from "react";

const AdminReadOnlyContext = createContext(false);
export const AdminReadOnlyProvider = AdminReadOnlyContext.Provider;
export const useAdminReadOnly = () => useContext(AdminReadOnlyContext);
