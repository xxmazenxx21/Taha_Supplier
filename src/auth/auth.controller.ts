import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @Public()
  signup(@Body() signupDto: SignupDto) {
    return this.authService.signup(signupDto);
  }

  @Post('login')
  @Public()
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }


  @Post('adminDashboard/signup')
  @Public()
  adminDashboardSignup(
    @Body()
    adminData: {
      name: string;
      email: string;
      password: string;
      phone: string;
    },
  ) {
    return this.authService.adminDashboardSignup(adminData);
  }

  @Post('adminDashboard/login')
  @Public()
  adminDashboardLogin(@Body() loginDto: LoginDto) {
    return this.authService.adminDashboardLogin(loginDto);
  }


}
