import type { UserDto } from "./dtos.ts";
import type { ServiceResult } from "./result.ts";

/** Read-only fictional-user query boundary. UI004 owns session behavior. */
export interface UserQueryService {
  getUser(input: { readonly userId: string }): Promise<ServiceResult<UserDto>>;
}
