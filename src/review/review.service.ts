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

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async create(productId: number, createReviewDto: CreateReviewDto) {
    createReviewDto.product_id = productId;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const review = await tx.review.create({
          data: {
            ...createReviewDto,
            product_id: productId,
          } as any,
          include: {
            product: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
              },
            },
          },
        });

        const agg = await tx.review.aggregate({
          where: { product_id: productId },
          _avg: {
            rating: true,
          },
          _count: {
            id: true,
          },
        });

        await tx.product.update({
          where: { id: productId },
          data: {
            rating: agg._avg.rating || 0,
            review_count: agg._count.id,
          },
        });

        return review;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequestException(
            'A review for this product by this user already exists',
          );
        }

        if (error.code === 'P2003') {
          throw new BadRequestException('Product or user does not exist');
        }
      }

      throw error;
    }
  }



  async update(id: number, updateReviewDto: UpdateReviewDto, userId: number) {
    const existing = await this.prisma.review.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException('Review not found');
    }

    if (existing.user_id !== userId) {
      throw new ForbiddenException('You can only modify your own reviews');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const review = await tx.review.update({
          where: { id },
          data: updateReviewDto,
          include: {
            product: true,
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });

        const agg = await tx.review.aggregate({
          where: { product_id: existing.product_id },
          _avg: {
            rating: true,
          },
          _count: {
            id: true,
          },
        });

        await tx.product.update({
          where: { id: existing.product_id },
          data: {
            rating: agg._avg.rating || 0,
            review_count: agg._count.id,
          },
        });

        return review;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequestException(
            'A review for this product by this user already exists',
          );
        }

        if (error.code === 'P2003') {
          throw new BadRequestException('Product or user does not exist');
        }
      }

      throw error;
    }
  }

  
  async remove(id: number, userId: number) {
    const existing = await this.prisma.review.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException('Review not found');
    }

    if (existing.user_id !== userId) {
      throw new ForbiddenException('You can only delete your own reviews');
    }

    return await this.prisma.$transaction(async (tx) => {
      const review = await tx.review.delete({
        where: { id },
        include: {
          product: true,
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      const agg = await tx.review.aggregate({
        where: { product_id: existing.product_id },
        _avg: {
          rating: true,
        },
        _count: {
          id: true,
        },
      });

      await tx.product.update({
        where: { id: existing.product_id },
        data: {
          rating: agg._avg.rating || 0,
          review_count: agg._count.id,
        },
      });

      return review;
    });
  }
}
