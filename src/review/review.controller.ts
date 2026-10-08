import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../decorators/roles.decorator';
import { ReviewService } from './review.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { FindProductReviewsDto } from './dto/find-product-reviews.dto';

type AuthedRequest = Request & { user: { sub: number } };

@Controller('review')
@Roles(UserRole.CLIENT)
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Get(':productId')
  @Roles(UserRole.CLIENT)
  findByProduct(
    @Req() req: AuthedRequest,
    @Param('productId') productId: string,
    @Query() query: FindProductReviewsDto,
  ) {
    return this.reviewService.findByProduct(
      this.parseId(productId, 'product'),
      req.user.sub,
      query,
    );
  }

  @Post(':productId')
  @Roles(UserRole.CLIENT)
  create(
    @Req() req: AuthedRequest,
    @Param('productId') productId: string,
    @Body() createReviewDto: CreateReviewDto,
  ) {
    return this.reviewService.create(
      this.parseId(productId, 'product'),
      req.user.sub,
      createReviewDto,
    );
  }

  @Patch(':productId/:reviewId')
  @Roles(UserRole.CLIENT)
  update(
    @Req() req: AuthedRequest,
    @Param('productId') productId: string,
    @Param('reviewId') reviewId: string,
    @Body() updateReviewDto: UpdateReviewDto,
  ) {
    return this.reviewService.update(
      this.parseId(productId, 'product'),
      this.parseId(reviewId, 'review'),
      req.user.sub,
      updateReviewDto,
    );
  }

  @Delete(':productId/:reviewId')
  @Roles(UserRole.CLIENT)
  remove(
    @Req() req: AuthedRequest,
    @Param('productId') productId: string,
    @Param('reviewId') reviewId: string,
  ) {
    return this.reviewService.remove(
      this.parseId(productId, 'product'),
      this.parseId(reviewId, 'review'),
      req.user.sub,
    );
  }

  private parseId(value: string, label: string): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
      throw new BadRequestException(`Invalid ${label} id`);
    }
    return id;
  }
}
