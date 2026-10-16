import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { principal, type Principal } from "./auth";
import { SecurityError } from "./policy";
export async function pagePrincipal(ownerOnly=false):Promise<Principal|null> {
  let unauthenticated=false;
  try { return await principal(await headers(),ownerOnly); }
  catch(e){unauthenticated=e instanceof SecurityError&&e.status===401;}
  if(unauthenticated)redirect('/login');
  return null;
}
