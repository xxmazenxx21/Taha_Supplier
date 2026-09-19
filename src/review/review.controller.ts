import { Controller, Get, Post, Body, Patch, Param, Delete, Req } from '@nestjs/common';
import { ReviewService } from './review.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../decorators/roles.decorator';
import { Request } from 'express';

@Controller('review')
@Roles(UserRole.CLIENT)
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Post(':productId')
  @Roles(UserRole.CLIENT)
  create(
    @Req() req: Request & { user: { sub: number } },
    @Param('productId') productId: string,
    @Body() createReviewDto: CreateReviewDto,
  ) {
    createReviewDto.user_id = req.user.sub;
    return this.reviewService.create(+productId, createReviewDto);
  }

  @Patch(':productId/:reviewId')
  @Roles(UserRole.CLIENT)
  update(
    @Req() req: Request & { user: { sub: number } },
    @Param('productId') productId: string,
    @Param('reviewId') reviewId: string,
    @Body() updateReviewDto: UpdateReviewDto,
  ) {
    return this.reviewService.update(+reviewId, updateReviewDto, req.user.sub);
  }

  @Delete(':productId/:reviewId')
  @Roles(UserRole.CLIENT)
  remove(
    @Req() req: Request & { user: { sub: number } },
    @Param('productId') productId: string,
    @Param('reviewId') reviewId: string,
  ) {
    return this.reviewService.remove(+reviewId, req.user.sub);
  }
}
