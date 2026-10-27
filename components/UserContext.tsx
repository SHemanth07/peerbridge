"use client";
import { createContext, useContext } from "react";

export interface Me { user_id: number; email: string; full_name: string; role: "student" | "admin"; reputation: number }
export const UserContext = createContext<Me | null>(null);
export const useMe = () => useContext(UserContext)!;
