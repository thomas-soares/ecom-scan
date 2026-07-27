import { Controller, Get, Module } from "@nestjs/common";

@Controller("auth")
class AuthController {
  @Get("health")
  health() {
    return {
      ok: true,
      provider: "better-auth",
      note: "Auth endpoints are served by Next.js /api/auth.",
    };
  }
}

@Module({
  controllers: [AuthController],
})
export class AuthModule {}
