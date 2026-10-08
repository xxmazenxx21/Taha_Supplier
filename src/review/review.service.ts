import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { FindProductReviewsDto } from './dto/find-product-reviews.dto';

/** Author fields safe to expose on a review. Never email or phone. */
const REVIEW_AUTHOR_SELECT = {
  id: true,
  name: true,
  shop_name: true,
} as const;

/** Author fields on a review returned from a write. */
const REVIEW_WRITE_AUTHOR_SELECT = {
  id: true,
  name: true,
} as const;

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async findByProduct(
    productId: number,
    userId: number,
    query: FindProductReviewsDto,
  ) {
    const { page = 1, per_page = 10 } = query;

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const skip = (page - 1) * per_page;

    const [total, reviews, myReview] = await Promise.all([
      this.prisma.review.count({ where: { product_id: productId } }),
      this.prisma.review.findMany({
        where: { product_id: productId },
        orderBy: { created_at: 'desc' },
        skip,
        take: per_page,
        include: { user: { select: REVIEW_AUTHOR_SELECT } },
      }),
      this.prisma.review.findUnique({
        where: {
          product_id_user_id: { product_id: productId, user_id: userId },
        },
        include: { user: { select: REVIEW_AUTHOR_SELECT } },
      }),
    ]);

    const last_page = Math.ceil(total / per_page) || 1;
    const next_page = page < last_page ? page + 1 : null;

    return {
      items: reviews.map((review) => this.formatReviewItem(review)),
      page,
      per_page,
      next_page,
      last_page,
      total,
      my_review: myReview ? this.formatReviewItem(myReview) : null,
    };
  }

  async create(
    productId: number,
    userId: number,
    createReviewDto: CreateReviewDto,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const review = await tx.review.create({
          data: {
            product_id: productId,
            user_id: userId,
            rating: createReviewDto.rating,
            comment: createReviewDto.comment,
          },
          include: { user: { select: REVIEW_WRITE_AUTHOR_SELECT } },
        });

        await this.recalculateProductRating(tx, productId);

        return review;
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async update(
    productId: number,
    reviewId: number,
    userId: number,
    updateReviewDto: UpdateReviewDto,
  ) {
    const existing = await this.prisma.review.findFirst({
      where: { id: reviewId, product_id: productId },
    });

    if (!existing) {
      throw new NotFoundException('Review not found');
    }

    if (existing.user_id !== userId) {
      throw new ForbiddenException('You can only modify your own reviews');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const review = await tx.review.update({
          where: { id: reviewId },
          data: {
            rating: updateReviewDto.rating,
            comment: updateReviewDto.comment,
          },
          include: { user: { select: REVIEW_WRITE_AUTHOR_SELECT } },
        });

        await this.recalculateProductRating(tx, productId);

        return review;
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async remove(productId: number, reviewId: number, userId: number) {
    const existing = await this.prisma.review.findFirst({
      where: { id: reviewId, product_id: productId },
    });

    if (!existing) {
      throw new NotFoundException('Review not found');
    }

    if (existing.user_id !== userId) {
      throw new ForbiddenException('You can only delete your own reviews');
    }

    return await this.prisma.$transaction(async (tx) => {
      const review = await tx.review.delete({
        where: { id: reviewId },
        include: { user: { select: REVIEW_WRITE_AUTHOR_SELECT } },
      });

      await this.recalculateProductRating(tx, productId);

      return review;
    });
  }

  private async recalculateProductRating(
    tx: Prisma.TransactionClient,
    productId: number,
  ): Promise<void> {
    const agg = await tx.review.aggregate({
      where: { product_id: productId },
      _avg: { rating: true },
      _count: { id: true },
    });

    await tx.product.update({
      where: { id: productId },
      data: {
        rating: agg._avg.rating || 0,
        review_count: agg._count.id,
      },
    });
  }

  private formatReviewItem(review: {
    id: number;
    rating: number;
    comment: string | null;
    created_at: Date;
    updated_at: Date;
    user: { id: number; name: string; shop_name: string | null };
  }) {
    return {
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      created_at: review.created_at,
      updated_at: review.updated_at,
      user: {
        id: review.user.id,
        name: review.user.name,
        shop_name: review.user.shop_name,
      },
    };
  }

  private mapWriteError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return new BadRequestException(
          'A review for this product by this user already exists',
        );
      }

      if (error.code === 'P2003') {
        return new BadRequestException('Product or user does not exist');
      }
    }

    return error;
  }
}
