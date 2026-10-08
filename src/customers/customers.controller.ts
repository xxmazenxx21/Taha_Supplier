import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../decorators/roles.decorator';
import { CustomersService } from './customers.service';
import { FindCustomersDto } from './dto/find-customers.dto';
import { UpdateCustomerStatusDto } from './dto/update-customer-status.dto';

@Controller('customers')
@Roles(UserRole.ADMIN)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get('admin')
  @Roles(UserRole.ADMIN)
  findAllForAdmin(@Query() query: FindCustomersDto) {
    return this.customersService.findAllForAdmin(query);
  }

  @Get('admin/:id')
  @Roles(UserRole.ADMIN)
  findOneForAdmin(@Param('id') id: string) {
    return this.customersService.findOneForAdmin(this.parseId(id));
  }

  @Patch('admin/:id/status')
  @Roles(UserRole.ADMIN)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateCustomerStatusDto) {
    return this.customersService.updateStatus(this.parseId(id), dto);
  }

  private parseId(value: string): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
      throw new BadRequestException('Invalid customer id');
    }
    return id;
  }
}
