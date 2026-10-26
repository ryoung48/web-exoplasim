      subroutine gcm_reference_step
      use pumamod
      integer, parameter :: NFIELDS = 9
!     Same surface balance as gcm_publish.f90 (ExoPlaSim's hfns)
      real, parameter :: L_TIMES_RHOH2O = -333700000.0
      real, save, allocatable :: zsum(:,:)
      integer, save :: isamples = 0
      real :: zg(NUGP,NFIELDS)
      real :: zzonal(NLAT,NFIELDS)
      integer :: jlat, jfield
      if (.not. allocated(zsum)) then
         allocate(zsum(NHOR,NFIELDS))
         zsum(:,:) = 0.0
      endif
      zsum(:,1) = zsum(:,1) + dt(:,NLEP)
      zsum(:,2) = zsum(:,2) + dtsa(:)
      zsum(:,3) = zsum(:,3) + dprc(:) + dprl(:)
      zsum(:,4) = zsum(:,4) + dcc(:,NLEP)
      zsum(:,5) = zsum(:,5) - dlwfl(:,1)
      zsum(:,6) = zsum(:,6) + dswfl(:,1) + dlwfl(:,1)
      zsum(:,7) = zsum(:,7) + dp(:)
      zsum(:,8) = zsum(:,8) + dsmelt(:) * L_TIMES_RHOH2O + dswfl(:,NLEP)  &
     &          + dlwfl(:,NLEP) + dshfl(:) + dlhfl(:)
      zsum(:,9) = zsum(:,9) + dicec(:)
      isamples = isamples + 1
      if (ndatim(2) /= 1 .or. ndatim(3) /= 1 .or. ndatim(4) /= 0 .or.     &
     &    ndatim(5) /= 0) return
      call mpgagp(zg, zsum, NFIELDS)
      if (mypid == NROOT) then
         do jfield = 1, NFIELDS
            do jlat = 1, NLAT
               zzonal(jlat,jfield) = sum(zg((jlat-1)*NLON+1:jlat*NLON,     &
     &            jfield)) / (NLON * isamples)
            enddo
         enddo
         open(98, file='reference-means.txt', position='append')
         write(98,'(i6,1x,i8,1x,i4,1x,i4)') ndatim(1) - 1, isamples,       &
     &      NFIELDS, NLAT
         write(98,'(4(es24.16,1x))') zzonal
         close(98)
      endif
      zsum(:,:) = 0.0
      isamples = 0
      end subroutine gcm_reference_step
